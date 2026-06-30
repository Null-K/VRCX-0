use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use specta::Type;
use tokio_util::sync::CancellationToken;
use vrcx_0_application::{RuntimeEventBus, TaskSupervisor};
use vrcx_0_integrations::llm::{LlmClient, ToolDefinition};
use vrcx_0_mcp::{spawn_in_process_tools, InProcessMcpTools, McpRuntime};
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_runtime_host::RuntimeHostState;

use crate::agent::{run_turn, TurnContext};
use crate::config::{
    obfuscate_api_key, AssistantConfig, PlaybookMode, ASSISTANT_ALLOW_WRITES_CONFIG_KEY,
    ASSISTANT_API_KEY_CONFIG_KEY, ASSISTANT_BASE_URL_CONFIG_KEY, ASSISTANT_MODEL_CONFIG_KEY,
    ASSISTANT_PLAYBOOK_MODE_CONFIG_KEY,
};

/// Tools that mutate state (local DB or the VRChat account). They are hidden
/// from the model unless the user has explicitly armed writes, so a prompt
/// injection in attacker-controlled data (e.g. a friend's bio) cannot drive an
/// autonomous write.
const WRITE_TOOLS: &[&str] = &["favorite_local", "favorite_vrchat", "set_friend_note"];
use crate::error::HarnessError;
use crate::events::AssistantEmitter;
use crate::session::{
    random_hex, ActiveTurn, Role, Session, SessionStore, SessionSummary, TurnStatus,
};

pub struct AssistantController {
    config: ConfigRepository,
    bus: RuntimeEventBus,
    tasks: TaskSupervisor,
    tools: Arc<InProcessMcpTools>,
    tool_defs: Arc<Vec<ToolDefinition>>,
    sessions: Arc<SessionStore>,
    cancels: Arc<Mutex<HashMap<String, (String, CancellationToken)>>>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AssistantConfigStatus {
    pub configured: bool,
    pub base_url: String,
    pub model: String,
    pub is_local: bool,
    pub allow_writes: bool,
    pub playbook_mode: PlaybookMode,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SendResult {
    pub session_id: String,
    pub turn_id: String,
}

impl AssistantController {
    pub async fn from_host(state: &RuntimeHostState) -> Result<Self, HarnessError> {
        let config = state.runtime_context.config.clone();
        let bus = state.runtime_context.event_bus.clone();
        let tasks = state.runtime_context.tasks.clone();
        let tools = Arc::new(spawn_in_process_tools(McpRuntime::from_host(state)).await?);
        let tool_defs = Arc::new(load_tool_defs(&tools).await?);
        Ok(Self {
            config,
            bus,
            tasks,
            tools,
            tool_defs,
            sessions: Arc::new(SessionStore::with_db(state.runtime_context.db.clone())),
            cancels: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    pub fn config_status(&self) -> Result<AssistantConfigStatus, HarnessError> {
        let config = AssistantConfig::load(&self.config)?;
        Ok(AssistantConfigStatus {
            configured: config.is_configured(),
            base_url: config.base_url.clone(),
            model: config.model.clone(),
            is_local: config.is_local(),
            allow_writes: config.allow_writes,
            playbook_mode: config.playbook_mode,
        })
    }

    pub fn set_config(
        &self,
        base_url: String,
        api_key: Option<String>,
        model: String,
        allow_writes: bool,
        playbook_mode: PlaybookMode,
    ) -> Result<AssistantConfigStatus, HarnessError> {
        self.config
            .set_bool(ASSISTANT_ALLOW_WRITES_CONFIG_KEY, allow_writes)?;
        self.config.set_string(
            ASSISTANT_PLAYBOOK_MODE_CONFIG_KEY,
            playbook_mode.as_config_str(),
        )?;
        let previous_base_url = self.config.get_string(ASSISTANT_BASE_URL_CONFIG_KEY, "")?;
        let base_url = base_url.trim();
        self.config
            .set_string(ASSISTANT_BASE_URL_CONFIG_KEY, base_url)?;
        self.config
            .set_string(ASSISTANT_MODEL_CONFIG_KEY, model.trim())?;
        match api_key {
            Some(api_key) => {
                self.config.set_string(
                    ASSISTANT_API_KEY_CONFIG_KEY,
                    &obfuscate_api_key(api_key.trim()),
                )?;
            }
            // Endpoint changed and no new key given: drop the old key so it is
            // never sent to a different provider.
            None if base_url != previous_base_url.trim() => {
                self.config.set_string(ASSISTANT_API_KEY_CONFIG_KEY, "")?;
            }
            None => {}
        }
        self.config_status()
    }

    pub async fn list_models(
        &self,
        base_url: String,
        api_key: Option<String>,
    ) -> Result<Vec<String>, HarnessError> {
        let saved = AssistantConfig::load(&self.config)?;
        let base_url = if base_url.trim().is_empty() {
            saved.base_url.clone()
        } else {
            base_url.trim().to_string()
        };
        let api_key = match api_key {
            Some(key) if !key.trim().is_empty() => key.trim().to_string(),
            _ => saved.api_key.clone(),
        };
        if base_url.is_empty() {
            return Err(HarnessError::NotConfigured);
        }
        let client = LlmClient::new(base_url, api_key, saved.model);
        Ok(client.list_models().await?)
    }

    pub fn list_sessions(&self) -> Vec<SessionSummary> {
        self.sessions.list()
    }

    pub fn get_session(&self, session_id: &str) -> Option<Session> {
        self.sessions.get(session_id)
    }

    pub fn new_session(&self) -> Session {
        self.sessions.create_session()
    }

    pub fn set_entity_panel_open(&self, session_id: &str, open: bool) {
        self.sessions.set_entity_panel_open(session_id, open);
    }

    pub fn delete_session(&self, session_id: &str) {
        self.cancel(session_id);
        self.sessions.delete(session_id);
    }

    pub fn cancel(&self, session_id: &str) {
        if let Some((_, token)) = self.cancels.lock().unwrap().remove(session_id) {
            token.cancel();
        }
    }

    pub async fn send_message(
        &self,
        session_id: Option<String>,
        text: String,
        locale: Option<String>,
    ) -> Result<SendResult, HarnessError> {
        let assistant_config = AssistantConfig::load(&self.config)?;
        let client = assistant_config.build_client()?;
        let tool_defs = if assistant_config.allow_writes {
            Arc::clone(&self.tool_defs)
        } else {
            Arc::new(
                self.tool_defs
                    .iter()
                    .filter(|tool| !WRITE_TOOLS.contains(&tool.name.as_str()))
                    .cloned()
                    .collect(),
            )
        };

        let session = self.sessions.ensure_session(session_id);
        let session_id = session.id.clone();
        let turn_id = format!("turn_{}", random_hex());

        // Record the user message synchronously, before spawning the turn, so a
        // rapid second send can never let a superseded turn's task push it later
        // (which reordered or duplicated messages in history).
        self.sessions.push_message(&session_id, Role::User, text);

        let cancel = CancellationToken::new();
        // Install the new turn as active and swap in its cancel token before
        // tearing down any previous turn, so a superseded turn sees it is no
        // longer current and exits without clobbering this one.
        self.sessions.set_active_turn(
            &session_id,
            Some(ActiveTurn {
                turn_id: turn_id.clone(),
                status: TurnStatus::Running,
            }),
        );
        let previous = self
            .cancels
            .lock()
            .unwrap()
            .insert(session_id.clone(), (turn_id.clone(), cancel.clone()));
        if let Some((_, previous_token)) = previous {
            previous_token.cancel();
        }

        let context = TurnContext {
            tools: Arc::clone(&self.tools),
            sessions: Arc::clone(&self.sessions),
            emitter: AssistantEmitter::new(self.bus.clone(), session_id.clone(), turn_id.clone()),
            client,
            tool_defs,
            session_id: session_id.clone(),
            turn_id: turn_id.clone(),
            locale,
            cancel,
            apply_playbook: assistant_config.should_apply_playbook(),
        };

        let cleanup = CancelCleanup {
            cancels: Arc::clone(&self.cancels),
            session_id: session_id.clone(),
            turn_id: turn_id.clone(),
        };
        self.tasks.spawn(async move {
            run_turn(context).await;
            drop(cleanup);
        });

        Ok(SendResult {
            session_id,
            turn_id,
        })
    }
}

async fn load_tool_defs(tools: &InProcessMcpTools) -> Result<Vec<ToolDefinition>, HarnessError> {
    Ok(tools
        .list_tools()
        .await?
        .into_iter()
        .map(|tool| ToolDefinition {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
        })
        .collect())
}

/// Removes the per-session cancel token when a turn task finishes, but only if
/// it still owns the slot — a turn superseded by a newer one must not evict the
/// newer turn's token (which would leave the new turn uncancellable).
struct CancelCleanup {
    cancels: Arc<Mutex<HashMap<String, (String, CancellationToken)>>>,
    session_id: String,
    turn_id: String,
}

impl Drop for CancelCleanup {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.cancels.lock() {
            if guard
                .get(&self.session_id)
                .is_some_and(|(turn_id, _)| turn_id == &self.turn_id)
            {
                guard.remove(&self.session_id);
            }
        }
    }
}
