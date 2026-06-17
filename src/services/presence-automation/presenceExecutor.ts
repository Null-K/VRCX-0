import userProfileRepository from '@/repositories/userProfileRepository';
import i18n from '@/services/i18nService';
import { useNotificationStore } from '@/state/notificationStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import type {
    MatchedPresenceRule,
    PresenceActionPatch,
    PresenceEvaluationResult,
    PresenceFacts
} from './presenceRuleEngine';

const DEFAULT_MIN_STATUS_WRITE_INTERVAL_MS = 60_000;
const DEFAULT_MIN_DESCRIPTION_WRITE_INTERVAL_MS = 60_000;
const DEFAULT_STABLE_LOCATION_MS = 30_000;
const MAX_AUDIT_LOGS = 50;

type CurrentUserRecord = Record<string, unknown> & {
    id?: unknown;
    status?: unknown;
    statusDescription?: unknown;
};
type WriteState = {
    lastStatusWriteAtMs: number;
    lastDescriptionWriteAtMs: number;
    lastStatusValue: string;
    lastDescriptionValue: string;
    nextAllowedAtMs: number;
    retryAfterMs: number;
    lastError: string;
};
type TimeRestoreSnapshot = {
    scopeKey: string;
    previousValue: string;
    automatedValue: string;
};
type PresenceThrottle = {
    minStatusWriteIntervalMs?: unknown;
    minDescriptionWriteIntervalMs?: unknown;
    stableLocationMs?: unknown;
};
type PresenceAutomationApplyInput = {
    facts: PresenceFacts;
    result: PresenceEvaluationResult;
    throttle?: PresenceThrottle;
};
type PresenceAuditLog = Record<string, unknown> & {
    createdAt: string;
    action?: string;
    patch?: PresenceActionPatch;
    matchedRules?: MatchedPresenceRule[];
};

const auditLogs: PresenceAuditLog[] = [];
const writeStates = new Map<string, WriteState>();
const timeRestoreSnapshots: Record<string, TimeRestoreSnapshot> = {};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function createWriteState(): WriteState {
    return {
        lastStatusWriteAtMs: 0,
        lastDescriptionWriteAtMs: 0,
        lastStatusValue: '',
        lastDescriptionValue: '',
        nextAllowedAtMs: 0,
        retryAfterMs: 0,
        lastError: ''
    };
}

function getWriteState(scopeKey: string): WriteState {
    if (!writeStates.has(scopeKey)) {
        writeStates.set(scopeKey, createWriteState());
    }
    return writeStates.get(scopeKey)!;
}

function hasOwn(object: object | null | undefined, key: string) {
    return Object.prototype.hasOwnProperty.call(object, key);
}

function addAuditLog(entry: Omit<PresenceAuditLog, 'createdAt'>) {
    auditLogs.unshift({
        createdAt: new Date().toISOString(),
        ...entry
    });
    auditLogs.splice(MAX_AUDIT_LOGS);
}

function getChangedPatch(
    currentUser: CurrentUserRecord,
    patch: PresenceActionPatch
) {
    const changed: PresenceActionPatch = {};
    if (hasOwn(patch, 'status') && currentUser?.status !== patch.status) {
        changed.status = patch.status;
    }
    if (
        hasOwn(patch, 'statusDescription') &&
        currentUser?.statusDescription !== patch.statusDescription
    ) {
        changed.statusDescription = patch.statusDescription;
    }
    return changed;
}

function getCurrentFieldValue(currentUser: CurrentUserRecord, field: string) {
    return String(currentUser?.[field] ?? '');
}

function getAutomationScopeKey(facts: PresenceFacts) {
    return `${facts?.endpoint || ''}:${facts?.currentUserId || ''}`;
}

function isCurrentAuthScope(facts: PresenceFacts) {
    const auth = useRuntimeStore.getState().auth;
    const authCurrentUserId =
        auth.currentUserId || auth.currentUserSnapshot?.id || '';
    return (
        String(auth.currentUserEndpoint || '') === String(facts?.endpoint || '') &&
        String(authCurrentUserId) === String(facts?.currentUserId || '')
    );
}

function pruneRestoreSnapshotsForScope(scopeKey: string) {
    for (const [field, snapshot] of Object.entries(timeRestoreSnapshots)) {
        if (snapshot.scopeKey !== scopeKey) {
            delete timeRestoreSnapshots[field];
        }
    }
}

function getTimeOwnedFieldRestores(result: PresenceEvaluationResult) {
    const fields = new Map<string, boolean>();
    for (const rule of result?.matchedRules || []) {
        if (rule?.domain !== 'time') {
            continue;
        }
        for (const field of rule.ownedFields || []) {
            if (field === 'status' || field === 'statusDescription') {
                fields.set(field, rule.restorePreviousState !== false);
            }
        }
    }
    return fields;
}

function getLocationScopedFields(result: PresenceEvaluationResult) {
    const fields = new Set<string>();
    for (const rule of result?.matchedRules || []) {
        if (rule?.domain === 'time') {
            continue;
        }
        for (const field of rule.ownedFields || []) {
            fields.add(field);
        }
    }
    return fields;
}

function hasLocationScopedChanges(
    result: PresenceEvaluationResult,
    changedPatch: PresenceActionPatch
) {
    const locationScopedFields = getLocationScopedFields(result);
    return Object.keys(changedPatch || {}).some((field) =>
        locationScopedFields.has(field)
    );
}

function buildPatchWithTimeRestore(
    currentUser: CurrentUserRecord,
    result: PresenceEvaluationResult,
    scopeKey: string
) {
    const patch: PresenceActionPatch = { ...(result?.patch || {}) };
    const timeOwnedFieldRestores = getTimeOwnedFieldRestores(result);
    const timeOwnedFields = new Set(timeOwnedFieldRestores.keys());
    const pendingRestores: string[] = [];
    const pendingSnapshotClears: string[] = [];

    for (const [field, restorePreviousState] of timeOwnedFieldRestores) {
        if (!restorePreviousState) {
            pendingSnapshotClears.push(field);
            continue;
        }
        if (!hasOwn(timeRestoreSnapshots, field)) {
            timeRestoreSnapshots[field] = {
                scopeKey,
                previousValue: getCurrentFieldValue(currentUser, field),
                automatedValue: String(patch[field] ?? '')
            };
            continue;
        }
        if (timeRestoreSnapshots[field].scopeKey !== scopeKey) {
            timeRestoreSnapshots[field] = {
                scopeKey,
                previousValue: getCurrentFieldValue(currentUser, field),
                automatedValue: String(patch[field] ?? '')
            };
            continue;
        }
        timeRestoreSnapshots[field].automatedValue = String(patch[field] ?? '');
    }

    for (const [field, snapshot] of Object.entries(timeRestoreSnapshots)) {
        if (snapshot.scopeKey !== scopeKey) {
            continue;
        }
        if (timeOwnedFields.has(field)) {
            continue;
        }
        if (
            !hasOwn(patch, field) &&
            getCurrentFieldValue(currentUser, field) === snapshot.automatedValue
        ) {
            patch[field] = snapshot.previousValue;
            pendingRestores.push(field);
        } else {
            pendingRestores.push(field);
        }
    }

    return { patch, pendingRestores, pendingSnapshotClears };
}

function completeTimeRestores(fields: string[]) {
    for (const field of fields || []) {
        delete timeRestoreSnapshots[field];
    }
}

function parseDateMs(value: unknown) {
    const timestamp = Date.parse(String(value || ''));
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function getRetryAfterMs(error: unknown) {
    const errorRecord = isRecord(error) ? error : {};
    const headers = isRecord(errorRecord.headers) ? errorRecord.headers : {};
    const headersGet = headers.get;
    const response = isRecord(errorRecord.response) ? errorRecord.response : {};
    const responseHeaders = isRecord(response.headers)
        ? response.headers
        : {};
    const retryAfter =
        (typeof headersGet === 'function'
            ? headersGet.call(headers, 'retry-after')
            : undefined) ||
        responseHeaders['retry-after'] ||
        errorRecord.retryAfter;
    const seconds = Number.parseInt(String(retryAfter || ''), 10);
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60000;
}

function shouldSkipForStableLocation(
    facts: PresenceFacts,
    stableLocationMs: unknown
) {
    if (facts.isTraveling) {
        return 'traveling';
    }
    const startedAtMs = parseDateMs(facts.currentLocationStartedAt);
    if (
        startedAtMs &&
        Date.now() - startedAtMs <
            Number(stableLocationMs || DEFAULT_STABLE_LOCATION_MS)
    ) {
        return 'location-stabilizing';
    }
    return '';
}

function shouldSkipForThrottle(
    changedPatch: PresenceActionPatch,
    throttle: PresenceThrottle,
    nowMs: number,
    state: WriteState
) {
    const minStatusWriteIntervalMs =
        Number(throttle.minStatusWriteIntervalMs) ||
        DEFAULT_MIN_STATUS_WRITE_INTERVAL_MS;
    const minDescriptionWriteIntervalMs =
        Number(throttle.minDescriptionWriteIntervalMs) ||
        DEFAULT_MIN_DESCRIPTION_WRITE_INTERVAL_MS;
    if (
        hasOwn(changedPatch, 'status') &&
        changedPatch.status === state.lastStatusValue &&
        nowMs - state.lastStatusWriteAtMs < minStatusWriteIntervalMs
    ) {
        return 'status-throttled';
    }
    if (
        hasOwn(changedPatch, 'statusDescription') &&
        changedPatch.statusDescription === state.lastDescriptionValue &&
        nowMs - state.lastDescriptionWriteAtMs < minDescriptionWriteIntervalMs
    ) {
        return 'description-throttled';
    }
    return '';
}

function updateWriteTimestamps(
    state: WriteState,
    changedPatch: PresenceActionPatch,
    nowMs: number
) {
    if (hasOwn(changedPatch, 'status')) {
        state.lastStatusWriteAtMs = nowMs;
        state.lastStatusValue = changedPatch.status;
    }
    if (hasOwn(changedPatch, 'statusDescription')) {
        state.lastDescriptionWriteAtMs = nowMs;
        state.lastDescriptionValue = changedPatch.statusDescription;
    }
}

export async function applyPresenceAutomationResult({
    facts,
    result,
    throttle = {}
}: PresenceAutomationApplyInput) {
    const currentUser =
        facts.currentUser && typeof facts.currentUser === 'object'
            ? (facts.currentUser as CurrentUserRecord)
            : null;
    const currentUserId = String(
        currentUser?.id || facts.currentUserId || ''
    ).trim();
    if (!currentUserId || !currentUser) {
        addAuditLog({
            action: 'profile-update',
            skippedReason: 'missing-current-user',
            patch: result?.patch || {}
        });
        return { applied: false, reason: 'missing-current-user' };
    }
    const currentUserSnapshot: CurrentUserRecord = currentUser.id
        ? currentUser
        : {
              ...currentUser,
              id: currentUserId
          };

    const scopeKey = getAutomationScopeKey(facts);
    const writeState = getWriteState(scopeKey);
    pruneRestoreSnapshotsForScope(scopeKey);
    const { patch: effectivePatch, pendingRestores, pendingSnapshotClears } =
        buildPatchWithTimeRestore(currentUserSnapshot, result, scopeKey);
    const pendingSnapshotCompletions = [
        ...pendingRestores,
        ...pendingSnapshotClears
    ];
    const changedPatch = getChangedPatch(currentUserSnapshot, effectivePatch);
    if (!Object.keys(changedPatch).length) {
        completeTimeRestores(pendingSnapshotCompletions);
        return { applied: false, reason: 'no-change' };
    }

    const stableReason = hasLocationScopedChanges(result, changedPatch)
        ? shouldSkipForStableLocation(facts, throttle.stableLocationMs)
        : '';
    if (stableReason) {
        addAuditLog({
            action: 'profile-update',
            skippedReason: stableReason,
            patch: changedPatch,
            matchedRules: result?.matchedRules || []
        });
        return { applied: false, reason: stableReason };
    }

    const nowMs = Date.now();
    if (nowMs < writeState.nextAllowedAtMs) {
        addAuditLog({
            action: 'profile-update',
            skippedReason: 'backoff',
            patch: changedPatch,
            matchedRules: result?.matchedRules || [],
            error: writeState.lastError
        });
        return { applied: false, reason: 'backoff' };
    }

    const throttleReason = shouldSkipForThrottle(
        changedPatch,
        throttle,
        nowMs,
        writeState
    );
    if (throttleReason) {
        addAuditLog({
            action: 'profile-update',
            skippedReason: throttleReason,
            patch: changedPatch,
            matchedRules: result?.matchedRules || []
        });
        return { applied: false, reason: throttleReason };
    }

    if (!isCurrentAuthScope(facts)) {
        addAuditLog({
            action: 'profile-update',
            skippedReason: 'auth-context-changed',
            patch: changedPatch,
            matchedRules: result?.matchedRules || []
        });
        return { applied: false, reason: 'auth-context-changed' };
    }

    try {
        const updatedUser = await userProfileRepository.updateCurrentUser({
            userId: currentUserId,
            endpoint: facts.endpoint,
            params: changedPatch
        });
        updateWriteTimestamps(writeState, changedPatch, nowMs);
        writeState.lastError = '';
        writeState.nextAllowedAtMs = 0;
        if (!isCurrentAuthScope(facts)) {
            addAuditLog({
                action: 'profile-update',
                patch: changedPatch,
                matchedRules: result?.matchedRules || [],
                note: 'auth-context-changed-after-write'
            });
            completeTimeRestores(pendingSnapshotCompletions);
            return {
                applied: true,
                patch: changedPatch,
                reason: 'auth-context-changed-after-write'
            };
        }
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserSnapshot: {
                ...currentUserSnapshot,
                ...(isRecord(updatedUser) ? updatedUser : {})
            }
        });
        useNotificationStore.getState().pushNotification({
            level: 'info',
            title: i18n.t(
                'service.background_maintenance.label.status_automatically_changed'
            ),
            message: [changedPatch.status, changedPatch.statusDescription]
                .filter((value) => value !== undefined && value !== '')
                .join(' / ')
        });
        addAuditLog({
            action: 'profile-update',
            patch: changedPatch,
            matchedRules: result?.matchedRules || []
        });
        completeTimeRestores(pendingSnapshotCompletions);
        return { applied: true, patch: changedPatch };
    } catch (error) {
        const retryAfterMs = getRetryAfterMs(error);
        writeState.retryAfterMs = retryAfterMs;
        writeState.nextAllowedAtMs = Date.now() + retryAfterMs;
        writeState.lastError =
            error instanceof Error ? error.message : String(error);
        addAuditLog({
            action: 'profile-update',
            patch: changedPatch,
            matchedRules: result?.matchedRules || [],
            error: writeState.lastError
        });
        return {
            applied: false,
            reason: 'error',
            error
        };
    }
}

export function resetPresenceAutomationExecutor() {
    auditLogs.length = 0;
    for (const key of Object.keys(timeRestoreSnapshots)) {
        delete timeRestoreSnapshots[key];
    }
    writeStates.clear();
}
