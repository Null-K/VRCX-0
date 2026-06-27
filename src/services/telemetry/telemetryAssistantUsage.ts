import { postTelemetry } from './telemetryClient';
import { isAnonymousUsageTelemetryEnabled } from './telemetryConfig';
import { buildTelemetryContext } from './telemetryPayload';
import type {
    TelemetryAssistantUsagePayload,
    TelemetrySessionState
} from './telemetryTypes';

let opens = 0;
let apiKeyConfigured = false;

export function recordAssistantOpen(): void {
    if (!isAnonymousUsageTelemetryEnabled()) {
        return;
    }
    opens += 1;
}

export function recordAssistantApiKeyConfigured(): void {
    if (!isAnonymousUsageTelemetryEnabled()) {
        return;
    }
    apiKeyConfigured = true;
}

export async function sendAssistantUsage(
    session: TelemetrySessionState
): Promise<void> {
    if (
        !isAnonymousUsageTelemetryEnabled() ||
        (opens === 0 && !apiKeyConfigured)
    ) {
        return;
    }
    const payload: TelemetryAssistantUsagePayload = {
        ...buildTelemetryContext(session),
        opens,
        ...(apiKeyConfigured ? { apiKeyConfigured: true } : {})
    };
    await postTelemetry('/api/v1/telemetry/assistant-usage', payload);
}

export function resetAssistantUsage(): void {
    opens = 0;
    apiKeyConfigured = false;
}
