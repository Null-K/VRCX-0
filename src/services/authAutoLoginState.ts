const AUTO_LOGIN_WINDOW_MS = 60 * 60 * 1000;
const AUTO_LOGIN_MAX_ATTEMPTS = 3;

const attemptTimestampsByKey = new Map<string, number[]>();

function normalizeThrottleKey(accountKey: unknown): string {
    if (typeof accountKey !== 'string' || !accountKey.trim()) {
        return '__global__';
    }

    return accountKey.trim();
}

function getAttemptBucket(accountKey: unknown): number[] {
    const normalizedKey = normalizeThrottleKey(accountKey);
    if (!attemptTimestampsByKey.has(normalizedKey)) {
        attemptTimestampsByKey.set(normalizedKey, []);
    }

    return attemptTimestampsByKey.get(normalizedKey)!;
}

function pruneAttempts(accountKey: unknown, now: number = Date.now()): void {
    const normalizedKey = normalizeThrottleKey(accountKey);
    const bucket = attemptTimestampsByKey.get(normalizedKey);
    if (!bucket) {
        return;
    }

    while (bucket.length > 0 && bucket[0] <= now - AUTO_LOGIN_WINDOW_MS) {
        bucket.shift();
    }

    if (bucket.length === 0) {
        attemptTimestampsByKey.delete(normalizedKey);
    }
}

export function getReactAutoLoginAttemptCount(
    accountKey: unknown,
    now: number = Date.now()
): number {
    pruneAttempts(accountKey, now);
    return (
        attemptTimestampsByKey.get(normalizeThrottleKey(accountKey))?.length ??
        0
    );
}

export function canAttemptReactAutoLogin(
    accountKey: unknown,
    now: number = Date.now()
): boolean {
    return (
        getReactAutoLoginAttemptCount(accountKey, now) < AUTO_LOGIN_MAX_ATTEMPTS
    );
}

export function recordReactAutoLoginAttempt(
    accountKey: unknown,
    now: number = Date.now()
): number {
    pruneAttempts(accountKey, now);
    const bucket = getAttemptBucket(accountKey);
    bucket.push(now);
    return bucket.length;
}

export function resetReactAutoLoginThrottle(accountKey?: unknown): void {
    if (accountKey === undefined) {
        attemptTimestampsByKey.clear();
        return;
    }

    attemptTimestampsByKey.delete(normalizeThrottleKey(accountKey));
}

export { AUTO_LOGIN_MAX_ATTEMPTS, AUTO_LOGIN_WINDOW_MS };
