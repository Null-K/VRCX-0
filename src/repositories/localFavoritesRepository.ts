import configRepository from './configRepository.js';
import sqliteRepository from './sqliteRepository.js';
import type { SQLiteRow, SQLiteValue } from './sqliteRepository.js';

type ObjectRow = Record<string, unknown>;

interface CacheEntryInput {
    id?: unknown;
    authorId?: unknown;
    authorName?: unknown;
    created_at?: unknown;
    description?: unknown;
    imageUrl?: unknown;
    name?: unknown;
    releaseStatus?: unknown;
    thumbnailImageUrl?: unknown;
    updated_at?: unknown;
    version?: unknown;
}

interface LocalFavoriteInput {
    kind?: unknown;
    entityId?: unknown;
    groupName?: unknown;
}

interface LocalFavoriteGroupInput {
    kind?: unknown;
    groupName?: unknown;
}

interface RenameLocalFavoriteGroupInput extends LocalFavoriteGroupInput {
    newGroupName?: unknown;
}

interface LocalFavoriteDeleteTarget {
    table: string;
    column: string;
    entityParam: string;
}

const LOCAL_FAVORITE_GROUP_CONFIG_KEYS = Object.freeze({
    friend: 'localFavoriteFriendGroups',
    avatar: 'localFavoriteAvatarGroups',
    world: 'localFavoriteWorldGroups'
});

function asObjectRow(row: SQLiteRow | null | undefined): ObjectRow {
    return row && !Array.isArray(row) ? row : {};
}

function asSQLiteValue(value: unknown): SQLiteValue {
    return value as SQLiteValue;
}

function getLocalFavoriteGroupConfigKey(kind: unknown): string | undefined {
    return (
        LOCAL_FAVORITE_GROUP_CONFIG_KEYS as Record<
            PropertyKey,
            string | undefined
        >
    )[kind as PropertyKey];
}

function normalizeWorldCacheRow(row: SQLiteRow | null | undefined) {
    if (Array.isArray(row)) {
        return {
            id: row[0] ?? '',
            authorId: row[2] ?? '',
            authorName: row[3] ?? '',
            created_at: row[4] ?? '',
            description: row[5] ?? '',
            imageUrl: row[6] ?? '',
            name: row[7] ?? '',
            releaseStatus: row[8] ?? '',
            thumbnailImageUrl: row[9] ?? '',
            updated_at: row[10] ?? '',
            version: row[11] ?? 0
        };
    }

    const record = asObjectRow(row);
    return {
        id: record.id ?? '',
        authorId: record.author_id ?? record.authorId ?? '',
        authorName: record.author_name ?? record.authorName ?? '',
        created_at: record.created_at ?? '',
        description: record.description ?? '',
        imageUrl: record.image_url ?? record.imageUrl ?? '',
        name: record.name ?? '',
        releaseStatus: record.release_status ?? record.releaseStatus ?? '',
        thumbnailImageUrl:
            record.thumbnail_image_url ?? record.thumbnailImageUrl ?? '',
        updated_at: record.updated_at ?? '',
        version: record.version ?? 0
    };
}

function normalizeAvatarCacheRow(row: SQLiteRow | null | undefined) {
    if (Array.isArray(row)) {
        return {
            id: row[0] ?? '',
            authorId: row[2] ?? '',
            authorName: row[3] ?? '',
            created_at: row[4] ?? '',
            description: row[5] ?? '',
            imageUrl: row[6] ?? '',
            name: row[7] ?? '',
            releaseStatus: row[8] ?? '',
            thumbnailImageUrl: row[9] ?? '',
            updated_at: row[10] ?? '',
            version: row[11] ?? 0
        };
    }

    const record = asObjectRow(row);
    return {
        id: record.id ?? '',
        authorId: record.author_id ?? record.authorId ?? '',
        authorName: record.author_name ?? record.authorName ?? '',
        created_at: record.created_at ?? '',
        description: record.description ?? '',
        imageUrl: record.image_url ?? record.imageUrl ?? '',
        name: record.name ?? '',
        releaseStatus: record.release_status ?? record.releaseStatus ?? '',
        thumbnailImageUrl:
            record.thumbnail_image_url ?? record.thumbnailImageUrl ?? '',
        updated_at: record.updated_at ?? '',
        version: record.version ?? 0
    };
}

function normalizeWorldFavoriteRow(row: SQLiteRow | null | undefined) {
    if (Array.isArray(row)) {
        return {
            created_at: row[1] ?? '',
            worldId: row[2] ?? '',
            groupName: row[3] ?? ''
        };
    }

    const record = asObjectRow(row);
    return {
        created_at: record.created_at ?? '',
        worldId: record.world_id ?? record.worldId ?? '',
        groupName: record.group_name ?? record.groupName ?? ''
    };
}

function normalizeAvatarFavoriteRow(row: SQLiteRow | null | undefined) {
    if (Array.isArray(row)) {
        return {
            created_at: row[1] ?? '',
            avatarId: row[2] ?? '',
            groupName: row[3] ?? ''
        };
    }

    const record = asObjectRow(row);
    return {
        created_at: record.created_at ?? '',
        avatarId: record.avatar_id ?? record.avatarId ?? '',
        groupName: record.group_name ?? record.groupName ?? ''
    };
}

function normalizeFriendFavoriteRow(row: SQLiteRow | null | undefined) {
    if (Array.isArray(row)) {
        return {
            created_at: row[1] ?? '',
            userId: row[2] ?? '',
            groupName: row[3] ?? ''
        };
    }

    const record = asObjectRow(row);
    return {
        created_at: record.created_at ?? '',
        userId: record.user_id ?? record.userId ?? '',
        groupName: record.group_name ?? record.groupName ?? ''
    };
}

function normalizeEntityId(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function resolveLocalFavoriteDeleteTarget(
    kind: unknown
): LocalFavoriteDeleteTarget | null {
    if (kind === 'friend') {
        return {
            table: 'favorite_friend',
            column: 'user_id',
            entityParam: '@user_id'
        };
    }

    if (kind === 'avatar') {
        return {
            table: 'favorite_avatar',
            column: 'avatar_id',
            entityParam: '@avatar_id'
        };
    }

    if (kind === 'world') {
        return {
            table: 'favorite_world',
            column: 'world_id',
            entityParam: '@world_id'
        };
    }

    return null;
}

function normalizeGroupName(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function normalizeGroupList(values: unknown) {
    return Array.from(
        new Set(
            (Array.isArray(values) ? values : [])
                .map(normalizeGroupName)
                .filter(Boolean)
        )
    ).sort((left, right) => left.localeCompare(right));
}

async function getExplicitLocalFavoriteGroups(kind: unknown) {
    const key = getLocalFavoriteGroupConfigKey(kind);
    if (!key) {
        return [];
    }

    return normalizeGroupList(await configRepository.getArray(key, []));
}

async function createLocalFavoriteGroup({
    kind,
    groupName
}: LocalFavoriteGroupInput) {
    const key = getLocalFavoriteGroupConfigKey(kind);
    const normalizedGroupName = normalizeGroupName(groupName);
    if (!key || !normalizedGroupName) {
        throw new Error(
            'LocalFavoritesRepository.createLocalFavoriteGroup requires kind and groupName.'
        );
    }

    const groups = normalizeGroupList(await configRepository.getArray(key, []));
    if (!groups.includes(normalizedGroupName)) {
        await configRepository.setArray(
            key,
            [...groups, normalizedGroupName].sort()
        );
    }
}

async function getWorldFavorites() {
    const rows = await sqliteRepository.query<SQLiteRow>(
        'SELECT * FROM favorite_world'
    );
    return Array.isArray(rows) ? rows.map(normalizeWorldFavoriteRow) : [];
}

async function getAvatarFavorites() {
    const rows = await sqliteRepository.query<SQLiteRow>(
        'SELECT * FROM favorite_avatar'
    );
    return Array.isArray(rows) ? rows.map(normalizeAvatarFavoriteRow) : [];
}

async function getFriendFavorites() {
    const rows = await sqliteRepository.query<SQLiteRow>(
        'SELECT * FROM favorite_friend'
    );
    return Array.isArray(rows) ? rows.map(normalizeFriendFavoriteRow) : [];
}

async function getWorldCache() {
    const rows = await sqliteRepository.query<SQLiteRow>(
        'SELECT * FROM cache_world'
    );
    return Array.isArray(rows) ? rows.map(normalizeWorldCacheRow) : [];
}

async function getAvatarCache() {
    const rows = await sqliteRepository.query<SQLiteRow>(
        'SELECT * FROM cache_avatar'
    );
    return Array.isArray(rows) ? rows.map(normalizeAvatarCacheRow) : [];
}

async function addWorldToCache(entry: CacheEntryInput) {
    return sqliteRepository.executeNonQuery(
        `INSERT OR REPLACE INTO cache_world (id, added_at, author_id, author_name, created_at, description, image_url, name, release_status, thumbnail_image_url, updated_at, version) VALUES (@id, @added_at, @author_id, @author_name, @created_at, @description, @image_url, @name, @release_status, @thumbnail_image_url, @updated_at, @version)`,
        {
            '@id': asSQLiteValue(entry.id),
            '@added_at': new Date().toJSON(),
            '@author_id': asSQLiteValue(entry.authorId),
            '@author_name': asSQLiteValue(entry.authorName),
            '@created_at': asSQLiteValue(entry.created_at),
            '@description': asSQLiteValue(entry.description),
            '@image_url': asSQLiteValue(entry.imageUrl),
            '@name': asSQLiteValue(entry.name),
            '@release_status': asSQLiteValue(entry.releaseStatus),
            '@thumbnail_image_url': asSQLiteValue(entry.thumbnailImageUrl),
            '@updated_at': asSQLiteValue(entry.updated_at),
            '@version': asSQLiteValue(entry.version)
        }
    );
}

async function getCachedWorldById(id: unknown) {
    const normalizedId = normalizeEntityId(id);
    if (!normalizedId) {
        return null;
    }
    const rows = await sqliteRepository.query<SQLiteRow>(
        'SELECT * FROM cache_world WHERE id = @id LIMIT 1',
        {
            '@id': normalizedId
        }
    );
    return Array.isArray(rows) && rows.length
        ? normalizeWorldCacheRow(rows[0])
        : null;
}

async function removeWorldFromCache(worldId: unknown) {
    const normalizedWorldId = normalizeEntityId(worldId);
    if (!normalizedWorldId) {
        return;
    }
    await sqliteRepository.executeNonQuery(
        'DELETE FROM cache_world WHERE id = @world_id',
        {
            '@world_id': normalizedWorldId
        }
    );
}

async function addLocalFavorite({
    kind,
    entityId,
    groupName
}: LocalFavoriteInput) {
    const target = resolveLocalFavoriteDeleteTarget(kind);
    const normalizedEntityId = normalizeEntityId(entityId);
    const normalizedGroupName = normalizeGroupName(groupName);

    if (!target || !normalizedEntityId || !normalizedGroupName) {
        throw new Error(
            'LocalFavoritesRepository.addLocalFavorite requires kind, entityId, and groupName.'
        );
    }

    return sqliteRepository.executeNonQuery(
        `INSERT OR REPLACE INTO ${target.table} (${target.column}, group_name, created_at) VALUES (${target.entityParam}, @group_name, @created_at)`,
        {
            [target.entityParam]: normalizedEntityId,
            '@group_name': normalizedGroupName,
            '@created_at': new Date().toJSON()
        }
    );
}

function addAvatarToFavorites(avatarId: unknown, groupName: unknown) {
    return addLocalFavorite({
        kind: 'avatar',
        entityId: avatarId,
        groupName
    });
}

function addWorldToFavorites(worldId: unknown, groupName: unknown) {
    return addLocalFavorite({
        kind: 'world',
        entityId: worldId,
        groupName
    });
}

function addFriendToLocalFavorites(userId: unknown, groupName: unknown) {
    return addLocalFavorite({
        kind: 'friend',
        entityId: userId,
        groupName
    });
}

async function removeLocalFavorite({
    kind,
    entityId,
    groupName
}: LocalFavoriteInput) {
    const target = resolveLocalFavoriteDeleteTarget(kind);
    const normalizedEntityId = normalizeEntityId(entityId);
    const normalizedGroupName = normalizeEntityId(groupName);

    if (!target || !normalizedEntityId || !normalizedGroupName) {
        throw new Error(
            'LocalFavoritesRepository.removeLocalFavorite requires kind, entityId, and groupName.'
        );
    }

    return sqliteRepository.executeNonQuery(
        `DELETE FROM ${target.table} WHERE ${target.column} = @entity_id AND group_name = @group_name`,
        {
            '@entity_id': normalizedEntityId,
            '@group_name': normalizedGroupName
        }
    );
}

async function renameLocalFavoriteGroup({
    kind,
    groupName,
    newGroupName
}: RenameLocalFavoriteGroupInput) {
    const target = resolveLocalFavoriteDeleteTarget(kind);
    const normalizedGroupName = normalizeGroupName(groupName);
    const normalizedNewGroupName = normalizeGroupName(newGroupName);

    if (!target || !normalizedGroupName || !normalizedNewGroupName) {
        throw new Error(
            'LocalFavoritesRepository.renameLocalFavoriteGroup requires kind, groupName, and newGroupName.'
        );
    }

    const result = await sqliteRepository.executeNonQuery(
        `UPDATE ${target.table} SET group_name = @new_group_name WHERE group_name = @group_name`,
        {
            '@new_group_name': normalizedNewGroupName,
            '@group_name': normalizedGroupName
        }
    );

    const key = getLocalFavoriteGroupConfigKey(kind);
    if (key) {
        const groups = normalizeGroupList(
            await configRepository.getArray(key, [])
        ).filter((value) => value !== normalizedGroupName);
        await configRepository.setArray(
            key,
            [...groups, normalizedNewGroupName].sort()
        );
    }

    return result;
}

async function deleteLocalFavoriteGroup({
    kind,
    groupName
}: LocalFavoriteGroupInput) {
    const target = resolveLocalFavoriteDeleteTarget(kind);
    const normalizedGroupName = normalizeGroupName(groupName);

    if (!target || !normalizedGroupName) {
        throw new Error(
            'LocalFavoritesRepository.deleteLocalFavoriteGroup requires kind and groupName.'
        );
    }

    const result = await sqliteRepository.executeNonQuery(
        `DELETE FROM ${target.table} WHERE group_name = @group_name`,
        {
            '@group_name': normalizedGroupName
        }
    );

    const key = getLocalFavoriteGroupConfigKey(kind);
    if (key) {
        const groups = normalizeGroupList(
            await configRepository.getArray(key, [])
        ).filter((value) => value !== normalizedGroupName);
        await configRepository.setArray(key, groups);
    }

    return result;
}

const localFavoritesRepository = Object.freeze({
    addAvatarToFavorites,
    addFriendToLocalFavorites,
    addWorldToCache,
    addWorldToFavorites,
    getExplicitLocalFavoriteGroups,
    createLocalFavoriteGroup,
    getCachedWorldById,
    getWorldFavorites,
    getAvatarFavorites,
    getFriendFavorites,
    getWorldCache,
    getAvatarCache,
    addLocalFavorite,
    removeLocalFavorite,
    renameLocalFavoriteGroup,
    deleteLocalFavoriteGroup,
    removeWorldFromCache
});

export {
    addAvatarToFavorites,
    addFriendToLocalFavorites,
    addWorldToCache,
    addWorldToFavorites,
    getExplicitLocalFavoriteGroups,
    createLocalFavoriteGroup,
    getCachedWorldById,
    getWorldFavorites,
    getAvatarFavorites,
    getFriendFavorites,
    getWorldCache,
    getAvatarCache,
    addLocalFavorite,
    removeLocalFavorite,
    renameLocalFavoriteGroup,
    deleteLocalFavoriteGroup,
    removeWorldFromCache
};
export default localFavoritesRepository;
