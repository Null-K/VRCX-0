export interface ParsedLocation {
    tag: string;
    isOffline: boolean;
    isPrivate: boolean;
    isTraveling: boolean;
    isRealInstance: boolean;
    worldId: string;
    instanceId: string;
    instanceName: string;
    accessType: string;
    accessTypeName: string;
    region: string;
    shortName: string;
    userId: string | null;
    hiddenId: string | null;
    privateId: string | null;
    friendsId: string | null;
    groupId: string | null;
    groupAccessType: string | null;
    canRequestInvite: boolean;
    strict: boolean;
    ageGate: boolean;
}

type LocationLike = {
    tag?: unknown;
    location?: unknown;
    $location?: {
        tag?: unknown;
        worldId?: unknown;
        instanceId?: unknown;
    };
    worldId?: unknown;
    world_id?: unknown;
    instanceId?: unknown;
    instance_id?: unknown;
    id?: unknown;
    isOffline?: unknown;
    isPrivate?: unknown;
    isTraveling?: unknown;
};

function isLocationLike(value: unknown): value is LocationLike {
    return Boolean(value && typeof value === 'object');
}

function displayLocation(
    location: string,
    worldName: string,
    groupName: any = ''
): string {
    let text = worldName;
    const L = parseLocation(location);
    if (L.isOffline) {
        text = 'Offline';
    } else if (L.isPrivate) {
        text = 'Private';
    } else if (L.isTraveling) {
        text = 'Traveling';
    } else if (L.worldId) {
        if (groupName) {
            text = `${worldName} ${L.accessTypeName}(${groupName})`;
        } else if (L.instanceId) {
            text = `${worldName} ${L.accessTypeName}`;
        }
    }
    return text;
}

function appendShortName(tag: string, shortName: string): string {
    if (!tag || !shortName || tag.includes('&shortName=')) {
        return tag;
    }
    return `${tag}&shortName=${shortName}`;
}

function normalizeLaunchUrlTag(tag: string): string {
    const trimmed = tag.trim();
    if (!/^(https?:\/\/|vrchat:\/\/)/i.test(trimmed)) {
        return tag;
    }

    try {
        const url = new URL(trimmed);
        const host = url.hostname.toLowerCase();
        const shortName = url.searchParams.get('shortName')?.trim() || '';

        if (
            (url.protocol === 'https:' || url.protocol === 'http:') &&
            (host === 'vrchat.com' || host.endsWith('.vrchat.com')) &&
            url.pathname === '/home/launch'
        ) {
            const worldId = url.searchParams.get('worldId')?.trim() || '';
            const instanceId = url.searchParams.get('instanceId')?.trim() || '';
            if (worldId && instanceId) {
                return appendShortName(`${worldId}:${instanceId}`, shortName);
            }
            return worldId || tag;
        }

        if (url.protocol === 'vrchat:' && host === 'launch') {
            const launchId = url.searchParams.get('id')?.trim() || '';
            return appendShortName(launchId, shortName) || tag;
        }
    } catch {
        return tag;
    }

    return tag;
}

function normalizeLocationTag(tag: unknown): string {
    if (typeof tag === 'string') {
        return normalizeLaunchUrlTag(tag);
    }
    if (!isLocationLike(tag)) {
        return String(tag || '');
    }

    const rawTag = normalizeLocationTag(
        tag.tag || tag.location || tag.$location?.tag
    );
    if (rawTag) {
        return rawTag;
    }
    const worldId = normalizeLocationTag(
        tag.worldId || tag.world_id || tag.$location?.worldId
    );
    const instanceId = normalizeLocationTag(
        tag.instanceId || tag.instance_id || tag.id || tag.$location?.instanceId
    );
    if (worldId && instanceId) {
        return `${worldId}:${instanceId}`;
    }
    if (tag.isOffline) {
        return 'offline';
    }
    if (tag.isPrivate) {
        return 'private';
    }
    if (tag.isTraveling) {
        return 'traveling';
    }
    return '';
}

function parseLocation(tag: unknown): ParsedLocation {
    let _tag = normalizeLocationTag(tag);
    const ctx: ParsedLocation = {
        tag: _tag,
        isOffline: false,
        isPrivate: false,
        isTraveling: false,
        isRealInstance: false,
        worldId: '',
        instanceId: '',
        instanceName: '',
        accessType: '',
        accessTypeName: '',
        region: '',
        shortName: '',
        userId: null,
        hiddenId: null,
        privateId: null,
        friendsId: null,
        groupId: null,
        groupAccessType: null,
        canRequestInvite: false,
        strict: false,
        ageGate: false
    };
    if (_tag === 'offline' || _tag === 'offline:offline') {
        ctx.isOffline = true;
    } else if (_tag === 'private' || _tag === 'private:private') {
        ctx.isPrivate = true;
    } else if (_tag === 'traveling' || _tag === 'traveling:traveling') {
        ctx.isTraveling = true;
    } else if (tag && !_tag.startsWith('local')) {
        ctx.isRealInstance = true;
        const sep = _tag.indexOf(':');
        const shortNameQualifier = '&shortName=';
        const shortNameIndex = _tag.indexOf(shortNameQualifier);
        if (shortNameIndex >= 0) {
            ctx.shortName = _tag.substr(
                shortNameIndex + shortNameQualifier.length
            );
            _tag = _tag.substr(0, shortNameIndex);
        }
        if (sep >= 0) {
            ctx.worldId = _tag.substr(0, sep);
            ctx.instanceId = _tag.substr(sep + 1);
            ctx.instanceId.split('~').forEach((s: any, i: any) => {
                if (i) {
                    const A = s.indexOf('(');
                    const Z = A >= 0 ? s.lastIndexOf(')') : -1;
                    const key = Z >= 0 ? s.substr(0, A) : s;
                    const value = A < Z ? s.substr(A + 1, Z - A - 1) : '';
                    if (key === 'hidden') {
                        ctx.hiddenId = value;
                    } else if (key === 'private') {
                        ctx.privateId = value;
                    } else if (key === 'friends') {
                        ctx.friendsId = value;
                    } else if (key === 'canRequestInvite') {
                        ctx.canRequestInvite = true;
                    } else if (key === 'region') {
                        ctx.region = value;
                    } else if (key === 'group') {
                        ctx.groupId = value;
                    } else if (key === 'groupAccessType') {
                        ctx.groupAccessType = value;
                    } else if (key === 'strict') {
                        ctx.strict = true;
                    } else if (key === 'ageGate') {
                        ctx.ageGate = true;
                    }
                } else {
                    ctx.instanceName = s;
                }
            });
            ctx.accessType = 'public';
            if (ctx.privateId !== null) {
                if (ctx.canRequestInvite) {
                    ctx.accessType = 'invite+';
                } else {
                    ctx.accessType = 'invite';
                }
                ctx.userId = ctx.privateId;
            } else if (ctx.friendsId !== null) {
                ctx.accessType = 'friends';
                ctx.userId = ctx.friendsId;
            } else if (ctx.hiddenId !== null) {
                ctx.accessType = 'friends+';
                ctx.userId = ctx.hiddenId;
            } else if (ctx.groupId !== null) {
                ctx.accessType = 'group';
            }
            ctx.accessTypeName = ctx.accessType;
            if (ctx.groupAccessType !== null) {
                if (ctx.groupAccessType === 'public') {
                    ctx.accessTypeName = 'groupPublic';
                } else if (ctx.groupAccessType === 'plus') {
                    ctx.accessTypeName = 'groupPlus';
                }
            }
        } else {
            ctx.worldId = _tag;
        }
    }
    return ctx;
}

function resolveRegion(L: ParsedLocation): string {
    if (L.isOffline || L.isPrivate || L.isTraveling) {
        return '';
    }
    if (L.region) {
        return L.region;
    }
    if (L.instanceId) {
        return 'us';
    }
    return '';
}

function translateAccessType(
    accessTypeName: string,
    t: (key: string) => string,
    keyMap: Record<string, string>
): string {
    const key = keyMap[accessTypeName];
    if (!key) {
        return accessTypeName;
    }
    if (accessTypeName === 'groupPublic' || accessTypeName === 'groupPlus') {
        const groupKey = keyMap['group'];
        const groupLabel = t(groupKey);
        const subtypeLabel = t(key);
        return subtypeLabel.startsWith(groupLabel)
            ? subtypeLabel
            : `${groupLabel} ${subtypeLabel}`;
    }
    return t(key);
}

export { parseLocation, displayLocation, resolveRegion, translateAccessType };
