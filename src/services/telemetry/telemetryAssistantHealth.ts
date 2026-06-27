import { postTelemetry } from './telemetryClient';
import { isAnonymousUsageTelemetryEnabled } from './telemetryConfig';
import {
    recordTelemetryErrorDetail,
    serializeTelemetryErrorDetails
} from './telemetryErrorDetails';
import { buildTelemetryContext } from './telemetryPayload';
import type {
    TelemetryErrorDetail,
    TelemetrySessionState
} from './telemetryTypes';

type AssistantToolErrorInput = {
    source?: string;
    args?: string;
    summary?: string;
};

// Failures the chat UI cannot surface on its own: a tool call that errored (the
// model silently works around it) or a turn that died without an answer. Counts
// are cumulative per session and sent last-write-wins, mirroring page-health.
let toolErrors = 0;
let turnErrors = 0;
const details = new Map<string, TelemetryErrorDetail>();

const SAFE_STRING_ARG_KEYS = new Set([
    'access',
    'groupBy',
    'group_by',
    'mode',
    'order',
    'period',
    'scope',
    'sort',
    'timeBound',
    'timeWindow',
    'time_bound',
    'time_window',
    'type'
]);

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function summarizeArgValue(key: string, value: unknown): string {
    if (value === null) {
        return 'null';
    }
    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (
            SAFE_STRING_ARG_KEYS.has(key) &&
            /^[A-Za-z0-9_.:-]{1,32}$/.test(trimmed)
        ) {
            return trimmed;
        }
        return '<text>';
    }
    if (Array.isArray(value)) {
        return '<array>';
    }
    if (typeof value === 'object') {
        return '<object>';
    }
    return '<value>';
}

function summarizeToolArgs(args?: string): string | undefined {
    if (!args?.trim()) {
        return undefined;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(args);
    } catch {
        return 'args=<text>';
    }
    if (!isRecord(parsed)) {
        return 'args=<value>';
    }
    const entries = Object.entries(parsed)
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(0, 8)
        .map(([key, value]) => `${key}=${summarizeArgValue(key, value)}`);
    return entries.length ? entries.join(', ') : undefined;
}

function buildToolErrorSummary(
    input: AssistantToolErrorInput
): string | undefined {
    const parts = [
        summarizeToolArgs(input.args),
        input.summary?.trim() ? 'result=<text>' : undefined
    ].filter((part): part is string => Boolean(part));
    return parts.length ? parts.join('; ') : undefined;
}

export function recordAssistantToolError(input: AssistantToolErrorInput): void {
    if (!isAnonymousUsageTelemetryEnabled()) {
        return;
    }
    toolErrors += 1;
    recordTelemetryErrorDetail(details, {
        kind: 'tool_error',
        source: input.source,
        summary: buildToolErrorSummary(input)
    });
}

export function recordAssistantTurnError(code: string, summary?: string): void {
    // `cancelled` is a user action (stop / superseded), not a failure.
    if (!isAnonymousUsageTelemetryEnabled() || code === 'cancelled') {
        return;
    }
    turnErrors += 1;
    recordTelemetryErrorDetail(details, {
        kind: 'turn_error',
        code,
        summary
    });
}

export async function sendAssistantHealth(
    session: TelemetrySessionState
): Promise<void> {
    if (
        !isAnonymousUsageTelemetryEnabled() ||
        (toolErrors === 0 && turnErrors === 0)
    ) {
        return;
    }
    await postTelemetry('/api/v1/telemetry/assistant-health', {
        ...buildTelemetryContext(session),
        toolErrors,
        turnErrors,
        details: serializeTelemetryErrorDetails(details)
    });
}

export function resetAssistantHealth(): void {
    toolErrors = 0;
    turnErrors = 0;
    details.clear();
}
