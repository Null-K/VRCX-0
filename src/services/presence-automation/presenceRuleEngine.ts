const STATUS_VALUES = new Set([
    'active',
    'join me',
    'ask me',
    'busy',
    'offline'
]);

type PresenceFacts = {
    now: Date | string | number;
    currentUser?: Record<string, unknown> | null;
    currentUserId: string;
    endpoint: string;
    isGameRunning: boolean;
    isTraveling: boolean;
    currentLocationStartedAt: string;
    instanceType: string;
    playerFactsKnown: boolean;
    playerCount: number;
    friendCount: number;
    presentFavoriteGroupKeys: string[];
    presentFriendIds: string[];
    canInviteFromCurrentLocation: boolean;
};

type PresenceCondition = Record<string, unknown> & {
    type?: unknown;
    start?: unknown;
    end?: unknown;
    days?: unknown;
    values?: unknown;
    op?: unknown;
    value?: unknown;
};

type PresenceActions = Record<string, unknown> & {
    status?: unknown;
    statusDescription?: unknown;
    clearStatusDescription?: unknown;
};

type PresenceRule = Record<string, unknown> & {
    id?: unknown;
    label?: unknown;
    enabled?: unknown;
    generated?: unknown;
    domain?: unknown;
    priority?: unknown;
    conditions?: unknown;
    actions?: PresenceActions;
    stopProcessing?: unknown;
    restorePreviousState?: unknown;
};

type PresenceActionPatch = {
    status?: string;
    statusDescription?: string;
};

type PresenceRuleMatch = {
    matched: boolean;
    reason: string;
};

type PresenceRuleEvaluationInput = {
    facts: PresenceFacts;
    rules: unknown;
};

type MatchedPresenceRule = {
    id: string;
    label: string;
    domain: string;
    priority: number;
    restorePreviousState: boolean;
    ownedFields: string[];
    actions: PresenceActionPatch;
};

type SkippedPresenceRule = {
    id: string;
    domain: string;
    reason: string;
};

type PresenceEvaluationResult = {
    patch: PresenceActionPatch;
    fieldOwners: Record<string, string>;
    matchedRules: MatchedPresenceRule[];
    skippedRules: SkippedPresenceRule[];
    explanation: Record<string, unknown>;
};

function normalizeString(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function compareNumbers(left: number, op: string, right: number) {
    if (op === '>') {
        return left > right;
    }
    if (op === '>=') {
        return left >= right;
    }
    if (op === '<') {
        return left < right;
    }
    if (op === '<=') {
        return left <= right;
    }
    if (op === '!=') {
        return left !== right;
    }
    return left === right;
}

function parseClockMinutes(value: unknown) {
    const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!match) {
        return null;
    }
    const hours = Number.parseInt(match[1], 10);
    const minutes = Number.parseInt(match[2], 10);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        return null;
    }
    return hours * 60 + minutes;
}

function getLocalDayValue(date: Date, offsetDays: number = 0) {
    if (!offsetDays) {
        const day = date.getDay();
        return day === 0 ? 7 : day;
    }
    const shifted = new Date(date);
    shifted.setDate(shifted.getDate() + offsetDays);
    const day = shifted.getDay();
    return day === 0 ? 7 : day;
}

function matchesDayFilter(
    days: number[],
    now: Date,
    activeDayOffset: number = 0
) {
    if (!days.length) {
        return true;
    }
    return days.includes(getLocalDayValue(now, activeDayOffset));
}

function matchesTimeWindow(
    condition: PresenceCondition,
    facts: PresenceFacts
) {
    const start = parseClockMinutes(condition.start);
    const end = parseClockMinutes(condition.end);
    if (start === null || end === null) {
        return false;
    }

    const now = facts.now instanceof Date ? facts.now : new Date(facts.now);
    const days = Array.isArray(condition.days)
        ? condition.days.map((day) => Number(day)).filter(Number.isFinite)
        : [];
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    if (start === end) {
        return matchesDayFilter(days, now);
    }
    if (end > start) {
        if (!matchesDayFilter(days, now)) {
            return false;
        }
        return nowMinutes >= start && nowMinutes < end;
    }
    if (nowMinutes >= start) {
        return matchesDayFilter(days, now);
    }
    if (nowMinutes < end) {
        return matchesDayFilter(days, now, -1);
    }
    return false;
}

function hasPlayerFacts(facts: PresenceFacts) {
    return facts?.playerFactsKnown === true;
}

function matchesCondition(
    condition: PresenceCondition,
    facts: PresenceFacts
) {
    const type = condition?.type;
    if (!type) {
        return false;
    }

    if (type === 'timeWindow') {
        return matchesTimeWindow(condition, facts);
    }
    if (type === 'playerFactsKnown') {
        return hasPlayerFacts(facts) === Boolean(condition.value ?? true);
    }
    if (type === 'instanceTypeIn') {
        const values = Array.isArray(condition.values) ? condition.values : [];
        return values.includes(facts.instanceType);
    }
    if (type === 'playerCount') {
        if (!hasPlayerFacts(facts)) {
            return false;
        }
        return compareNumbers(
            facts.playerCount,
            normalizeString(condition.op) || '==',
            Number(condition.value) || 0
        );
    }
    if (type === 'friendCount') {
        if (!hasPlayerFacts(facts)) {
            return false;
        }
        return compareNumbers(
            facts.friendCount,
            normalizeString(condition.op) || '==',
            Number(condition.value) || 0
        );
    }
    if (type === 'hasAnyFriend') {
        if (!hasPlayerFacts(facts)) {
            return false;
        }
        return facts.friendCount > 0;
    }
    if (type === 'hasFriendInGroups') {
        if (!hasPlayerFacts(facts)) {
            return false;
        }
        const values = Array.isArray(condition.values) ? condition.values : [];
        return values.some((groupKey) =>
            facts.presentFavoriteGroupKeys.includes(normalizeString(groupKey))
        );
    }
    if (type === 'hasSpecificFriend') {
        if (!hasPlayerFacts(facts)) {
            return false;
        }
        const values = Array.isArray(condition.values) ? condition.values : [];
        return values.some((userId) =>
            facts.presentFriendIds.includes(normalizeString(userId))
        );
    }
    if (type === 'isAlone') {
        if (!hasPlayerFacts(facts)) {
            return false;
        }
        return facts.playerCount === 0;
    }
    if (type === 'withCompany') {
        if (!hasPlayerFacts(facts)) {
            return false;
        }
        return facts.playerCount > 0;
    }
    if (type === 'isTraveling') {
        return facts.isTraveling === Boolean(condition.value ?? true);
    }
    if (type === 'isGameRunning') {
        return facts.isGameRunning === Boolean(condition.value ?? true);
    }
    if (type === 'canInviteFromCurrentLocation') {
        return (
            facts.canInviteFromCurrentLocation ===
            Boolean(condition.value ?? true)
        );
    }

    return false;
}

function validateActionPatch(actions: PresenceActions = {}) {
    const patch: PresenceActionPatch = {};
    const status = normalizeString(actions.status);
    if (status && STATUS_VALUES.has(status)) {
        patch.status = status;
    }
    if (Object.prototype.hasOwnProperty.call(actions, 'statusDescription')) {
        patch.statusDescription = String(
            actions.statusDescription ?? ''
        ).slice(0, 32);
    } else if (actions.clearStatusDescription) {
        patch.statusDescription = '';
    }
    return patch;
}

function evaluateRule(
    rule: PresenceRule,
    facts: PresenceFacts
): PresenceRuleMatch {
    const conditions: PresenceCondition[] = Array.isArray(rule.conditions)
        ? rule.conditions.filter(
              (condition): condition is PresenceCondition =>
                  Boolean(condition && typeof condition === 'object')
          )
        : [];
    for (const condition of conditions) {
        if (!matchesCondition(condition, facts)) {
            return {
                matched: false,
                reason: `condition:${condition?.type || 'unknown'}`
            };
        }
    }
    return { matched: true, reason: 'matched' };
}

export function evaluatePresenceRules({
    facts,
    rules
}: PresenceRuleEvaluationInput): PresenceEvaluationResult {
    const sortedRules = [...(Array.isArray(rules) ? rules : [])]
        .filter(
            (rule): rule is PresenceRule =>
                Boolean(rule && typeof rule === 'object') &&
                (rule as PresenceRule).enabled !== false
        )
        .sort((left, right) => {
            const priorityDelta =
                Number(right.priority || 0) - Number(left.priority || 0);
            if (priorityDelta) {
                return priorityDelta;
            }
            return String(left.id || '').localeCompare(String(right.id || ''));
        });
    const patch: PresenceActionPatch = {};
    const fieldOwners: Record<string, string> = {};
    const stoppedDomains = new Set<string>();
    const matchedRules: MatchedPresenceRule[] = [];
    const skippedRules: SkippedPresenceRule[] = [];

    for (const rule of sortedRules) {
        const id = normalizeString(rule.id);
        const domain = normalizeString(rule.domain) || 'context';
        if (stoppedDomains.has(domain)) {
            skippedRules.push({
                id,
                domain,
                reason: 'domain-stopped'
            });
            continue;
        }

        const result = evaluateRule(rule, facts);
        if (!result.matched) {
            skippedRules.push({
                id,
                domain,
                reason: result.reason
            });
            continue;
        }

        const actionPatch = validateActionPatch(rule.actions || {});
        const ownedFields = [];
        for (const [field, value] of Object.entries(actionPatch)) {
            if (!Object.prototype.hasOwnProperty.call(fieldOwners, field)) {
                patch[field] = value;
                fieldOwners[field] = id;
                ownedFields.push(field);
            }
        }

        matchedRules.push({
            id,
            label: normalizeString(rule.label) || id,
            domain,
            priority: Number(rule.priority) || 0,
            restorePreviousState: rule.restorePreviousState !== false,
            ownedFields,
            actions: actionPatch
        });

        if (rule.stopProcessing) {
            stoppedDomains.add(domain);
        }
    }

    return {
        patch,
        fieldOwners,
        matchedRules,
        skippedRules,
        explanation: {
            desiredStatus: patch.status || facts.currentUser?.status || '',
            desiredStatusDescription:
                Object.prototype.hasOwnProperty.call(patch, 'statusDescription')
                    ? patch.statusDescription
                    : facts.currentUser?.statusDescription || '',
            matchedRuleCount: matchedRules.length,
            skippedRuleCount: skippedRules.length
        }
    };
}

export { STATUS_VALUES };
export type {
    MatchedPresenceRule,
    PresenceActions,
    PresenceActionPatch,
    PresenceCondition,
    PresenceFacts,
    PresenceEvaluationResult,
    PresenceRule,
    SkippedPresenceRule
};
