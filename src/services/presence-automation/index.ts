import { buildPresenceFacts } from './presenceFacts';
import { loadPresenceAutomationConfig } from './presenceConfig';
import { applyPresenceAutomationResult } from './presenceExecutor';
import { evaluatePresenceRules } from './presenceRuleEngine';

type PresenceAutomationRunOptions = {
    now?: Date;
};

export async function runPresenceAutomation({
    now = new Date()
}: PresenceAutomationRunOptions = {}) {
    const config = await loadPresenceAutomationConfig();
    if (!config.enabled) {
        return {
            facts: null,
            config,
            result: {
                patch: {},
                matchedRules: [],
                skippedRules: [],
                explanation: {
                    matchedRuleCount: 0,
                    skippedRuleCount: 0
                }
            },
            applied: {
                applied: false,
                reason: 'disabled'
            }
        };
    }
    const facts = await buildPresenceFacts({ now });
    const result = evaluatePresenceRules({
        facts,
        rules: config.rules
    });
    const applied = await applyPresenceAutomationResult({
        facts,
        result,
        throttle: config.throttle
    });
    return {
        facts,
        config,
        result,
        applied
    };
}

export { buildPresenceFacts } from './presenceFacts';
export { loadPresenceAutomationConfig } from './presenceConfig';
export {
    applyPresenceAutomationResult,
    resetPresenceAutomationExecutor
} from './presenceExecutor';
export { evaluatePresenceRules } from './presenceRuleEngine';
