const HTTP_ERROR_STATUS_MIN = 400;
const HTTP_ERROR_STATUS_MAX = 599;
const MAX_MESSAGE_LENGTH = 12000;
const MAX_OBJECT_DEPTH = 3;

let installed = false;
let flushingLogQueue = false;
let originalConsoleError = null;
const logQueue = [];

function isRecord(value) {
    return Boolean(value && typeof value === 'object');
}

function pad(value, length = 2) {
    return String(value).padStart(length, '0');
}

function formatLocalTimestamp(date) {
    const offsetMinutes = -date.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const absoluteOffset = Math.abs(offsetMinutes);

    return [
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
        `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`,
        `${sign}${pad(Math.floor(absoluteOffset / 60))}:${pad(absoluteOffset % 60)}`
    ].join(' ');
}

function truncate(value) {
    if (value.length <= MAX_MESSAGE_LENGTH) {
        return value;
    }

    return `${value.slice(0, MAX_MESSAGE_LENGTH)}\n... <truncated>`;
}

function serializeValue(value, depth = 0, seen = new Set()) {
    if (value instanceof Error) {
        return value.stack || value.message || value.name;
    }

    if (typeof value === 'string') {
        return value;
    }

    if (
        value === null ||
        value === undefined ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        typeof value === 'bigint'
    ) {
        return String(value);
    }

    if (!isRecord(value)) {
        return String(value);
    }

    if (seen.has(value)) {
        return '[Circular]';
    }

    if (depth >= MAX_OBJECT_DEPTH) {
        return Object.prototype.toString.call(value);
    }

    try {
        seen.add(value);
        return JSON.stringify(
            value,
            (_, nestedValue) => {
                if (nestedValue instanceof Error) {
                    return {
                        name: nestedValue.name,
                        message: nestedValue.message,
                        stack: nestedValue.stack
                    };
                }
                return nestedValue;
            },
            2
        );
    } catch {
        return String(value);
    } finally {
        seen.delete(value);
    }
}

function collectText(value, depth = 0, seen = new Set()) {
    if (value instanceof Error) {
        return [value.name, value.message, value.stack]
            .filter(Boolean)
            .join('\n');
    }

    if (typeof value === 'string') {
        return value;
    }

    if (!isRecord(value) || seen.has(value) || depth > MAX_OBJECT_DEPTH) {
        return '';
    }

    seen.add(value);
    const parts = [];
    for (const key of ['message', 'statusText', 'url', 'endpoint', 'stack']) {
        const field = value[key];
        if (typeof field === 'string') {
            parts.push(field);
        }
    }

    for (const key of ['error', 'cause', 'reason', 'response']) {
        const field = value[key];
        const text = collectText(field, depth + 1, seen);
        if (text) {
            parts.push(text);
        }
    }
    seen.delete(value);
    return parts.join('\n');
}

function hasHttpErrorStatus(value, depth = 0, seen = new Set()) {
    if (!isRecord(value) || seen.has(value) || depth > MAX_OBJECT_DEPTH) {
        return false;
    }

    seen.add(value);
    for (const key of ['status', 'statusCode']) {
        const status = Number(value[key]);
        if (
            Number.isInteger(status) &&
            status >= HTTP_ERROR_STATUS_MIN &&
            status <= HTTP_ERROR_STATUS_MAX
        ) {
            seen.delete(value);
            return true;
        }
    }

    for (const key of ['error', 'cause', 'reason', 'response']) {
        if (hasHttpErrorStatus(value[key], depth + 1, seen)) {
            seen.delete(value);
            return true;
        }
    }

    seen.delete(value);
    return false;
}

function hasNetworkErrorText(text) {
    return [
        /Failed to load resource/i,
        /\bHTTP\s+(?:4\d\d|5\d\d)\b/i,
        /\bstatus(?:Code|\s+code)?[:=]?\s*(?:4\d\d|5\d\d)\b/i,
        /\b(?:GET|POST|PUT|PATCH|DELETE)\b[^\n]*(?:4\d\d|5\d\d)\b/i,
        /\b(?:VRChat request|GitHub release request|Translation API|Avatar search|Media file upload|Update download|Web API execution)\s+failed\b/i,
        /\brequest failed\s*\((?:4\d\d|5\d\d)\)/i,
        /\berror:\s*\{?[^\n]*(?:4\d\d|5\d\d)\b/i
    ].some((pattern) => pattern.test(text));
}

function shouldSkipErrorLog(values) {
    if (values.some((value) => hasHttpErrorStatus(value))) {
        return true;
    }

    return hasNetworkErrorText(
        values.map((value) => collectText(value)).join('\n')
    );
}

function formatEntry(source, lines) {
    const now = new Date();
    return truncate(
        [
            `[${formatLocalTimestamp(now)}] [${now.toISOString()}] [${source}]`,
            ...lines.filter(Boolean)
        ].join('\n')
    );
}

async function flushLogQueue() {
    if (flushingLogQueue) {
        return;
    }

    flushingLogQueue = true;
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        while (logQueue.length > 0) {
            const nextEntry = logQueue.shift();
            try {
                await invoke('app__append_error_log', { entry: nextEntry });
            } catch {
                // Logging must never affect the app path that produced the error.
            }
        }
    } catch {
        // Logging must never affect the app path that produced the error.
    } finally {
        flushingLogQueue = false;
        if (logQueue.length > 0) {
            void flushLogQueue();
        }
    }
}

async function appendEntry(entry) {
    logQueue.push(entry);
    await flushLogQueue();
}

export async function recordErrorLog(source, values) {
    const normalizedValues = Array.isArray(values) ? values : [values];
    if (shouldSkipErrorLog(normalizedValues)) {
        return;
    }

    const entry = formatEntry(
        source,
        normalizedValues.map((value) => serializeValue(value))
    );
    await appendEntry(entry);
}

function handleWindowError(event) {
    if (typeof ErrorEvent !== 'undefined' && !(event instanceof ErrorEvent)) {
        return;
    }

    if (event.target && event.target !== window) {
        return;
    }

    const values = [
        event.error,
        event.message,
        event.filename
            ? `${event.filename}:${event.lineno || 0}:${event.colno || 0}`
            : ''
    ].filter(Boolean);

    void recordErrorLog('js:error', values);
}

function handleUnhandledRejection(event) {
    void recordErrorLog('js:unhandledrejection', [
        event.reason || 'Unhandled promise rejection'
    ]);
}

function installConsoleErrorCapture() {
    if (originalConsoleError) {
        return;
    }

    originalConsoleError = console.error.bind(console);
    console.error = (...args) => {
        originalConsoleError(...args);
        void recordErrorLog('js:console.error', args);
    };
}

export function installErrorLogging() {
    if (installed || typeof window === 'undefined') {
        return;
    }

    installed = true;
    window.addEventListener('error', handleWindowError, true);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    installConsoleErrorCapture();
}
