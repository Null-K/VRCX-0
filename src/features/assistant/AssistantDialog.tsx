import { PanelRightIcon, XIcon } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { useAssistantChatStore } from '@/state/assistantChatStore';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup
} from '@/ui/shadcn/resizable';
import { ScrollArea } from '@/ui/shadcn/scroll-area';

import {
    cancelActiveTurn,
    refreshSessions,
    sendMessage,
    setEntityPanelOpen
} from './assistantActions';
import { Composer } from './components/Composer';
import { EntityPanel } from './components/EntityPanel';
import { MessageBubble } from './components/MessageBubble';
import { SessionSidebar } from './components/SessionSidebar';
import { useAssistantConfigStatus } from './useAssistantConfigStatus';
import { useAssistantEvents } from './useAssistantEvents';
import type { AssistantHealth } from './useAssistantHealth';
import { useAssistantHealth } from './useAssistantHealth';

const HEALTH_DOT_CLASS: Record<AssistantHealth, string> = {
    checking: 'bg-amber-500 animate-pulse',
    ok: 'bg-emerald-500',
    error: 'bg-destructive',
    unconfigured: 'bg-muted-foreground/50'
};

export function AssistantDialog() {
    const { t } = useTranslation();
    useAssistantEvents();
    const config = useAssistantConfigStatus();
    const health = useAssistantHealth(Boolean(config?.configured));

    const open = useAssistantChatStore((state) => state.open);
    const setOpen = useAssistantChatStore((state) => state.setOpen);
    const activeSessionId = useAssistantChatStore(
        (state) => state.activeSessionId
    );
    const entityPanelOpen = useAssistantChatStore((state) =>
        state.activeSessionId
            ? (state.entityPanelOpenBySession[state.activeSessionId] ?? false)
            : false
    );
    const messages = useAssistantChatStore((state) =>
        activeSessionId ? state.messagesBySession[activeSessionId] : undefined
    );
    const busy = useAssistantChatStore((state) =>
        activeSessionId ? Boolean(state.busySessions[activeSessionId]) : false
    );

    const bottomRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (open) {
            refreshSessions();
        }
    }, [open]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ block: 'end' });
    }, [messages]);

    const notConfigured = !config?.configured;
    const examplePrompts = useMemo(
        () => [
            t('assistant.example_1'),
            t('assistant.example_2'),
            t('assistant.example_3')
        ],
        [t]
    );

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent
                className="flex h-[84vh] w-[min(1360px,96vw)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
                showCloseButton={false}
            >
                <DialogHeader className="border-border/40 flex-row items-center justify-between space-y-0 border-b py-3 pr-3 pl-4">
                    <DialogTitle className="text-sm">
                        {t('assistant.title')}
                    </DialogTitle>
                    <div className="flex items-center gap-1.5">
                        <span
                            className="text-muted-foreground mr-1 flex items-center gap-1.5 text-xs"
                            title={t(`assistant.connection.${health}`)}
                        >
                            <span
                                className={cn(
                                    'size-2 rounded-full',
                                    HEALTH_DOT_CLASS[health]
                                )}
                            />
                            <span className="hidden sm:inline">
                                {t(`assistant.connection.${health}`)}
                            </span>
                        </span>
                        <button
                            type="button"
                            onClick={() => setEntityPanelOpen(!entityPanelOpen)}
                            title={t('assistant.entities_title')}
                            className={cn(
                                'rounded-md p-1.5 transition-colors',
                                entityPanelOpen
                                    ? 'text-foreground bg-card'
                                    : 'text-muted-foreground hover:text-foreground'
                            )}
                        >
                            <PanelRightIcon className="size-4" />
                        </button>
                        <DialogClose
                            className="text-muted-foreground hover:text-foreground rounded-md p-1.5 transition-colors"
                            title={t('assistant.close')}
                        >
                            <XIcon className="size-4" />
                            <span className="sr-only">
                                {t('assistant.close')}
                            </span>
                        </DialogClose>
                    </div>
                </DialogHeader>

                <ResizablePanelGroup
                    orientation="horizontal"
                    className="min-h-0 flex-1"
                >
                    <ResizablePanel
                        id="assistant-sessions"
                        defaultSize="20%"
                        minSize="12%"
                        maxSize="32%"
                    >
                        <SessionSidebar />
                    </ResizablePanel>
                    <ResizableHandle />
                    <ResizablePanel
                        id="assistant-chat"
                        defaultSize={entityPanelOpen ? '56%' : '80%'}
                        minSize="30%"
                    >
                        <div className="flex h-full min-w-0 flex-col">
                            <ScrollArea className="min-h-0 flex-1">
                                <div className="flex flex-col gap-4 p-4">
                                    {(!messages || messages.length === 0) && (
                                        <div className="flex flex-col items-center gap-3 py-12 text-center">
                                            <p className="text-sm font-medium">
                                                {t('assistant.empty_title')}
                                            </p>
                                            <div className="flex flex-col gap-1.5">
                                                {examplePrompts.map(
                                                    (prompt) => (
                                                        <button
                                                            key={prompt}
                                                            type="button"
                                                            disabled={
                                                                notConfigured
                                                            }
                                                            onClick={() =>
                                                                sendMessage(
                                                                    prompt
                                                                )
                                                            }
                                                            className="border-border/50 text-muted-foreground hover:bg-card/60 hover:text-foreground rounded-full border px-3 py-1 text-xs disabled:opacity-50"
                                                        >
                                                            {prompt}
                                                        </button>
                                                    )
                                                )}
                                            </div>
                                        </div>
                                    )}
                                    {messages?.map((message) => (
                                        <MessageBubble
                                            key={message.id}
                                            message={message}
                                        />
                                    ))}
                                    <div ref={bottomRef} />
                                </div>
                            </ScrollArea>

                            {notConfigured && (
                                <div className="text-muted-foreground px-3 pt-2 text-center text-xs">
                                    {t('assistant.not_configured')}
                                </div>
                            )}
                            <Composer
                                busy={busy}
                                disabled={notConfigured}
                                onSend={(text) => sendMessage(text)}
                                onStop={() => cancelActiveTurn()}
                            />
                        </div>
                    </ResizablePanel>
                    {entityPanelOpen && (
                        <>
                            <ResizableHandle />
                            <ResizablePanel
                                id="assistant-entities"
                                defaultSize="24%"
                                minSize="288px"
                                maxSize="45%"
                            >
                                <EntityPanel />
                            </ResizablePanel>
                        </>
                    )}
                </ResizablePanelGroup>
            </DialogContent>
        </Dialog>
    );
}
