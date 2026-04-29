import sqliteRepository from './sqliteRepository.js';
import type { SQLiteRow, SQLiteValue } from './sqliteRepository.js';
import { normalizeUserTablePrefix } from './userSessionRepository.js';

type ObjectRow = Record<string, unknown>;

interface AvatarCacheInput {
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

interface AvatarTag {
    tag: unknown;
    color: unknown;
}

function asObjectRow(row: SQLiteRow | null | undefined): ObjectRow {
    return row && !Array.isArray(row) ? row : {};
}

function asSQLiteValue(value: unknown): SQLiteValue {
    return value as SQLiteValue;
}

function normalizeId(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function parseInteger(value: unknown, fallback: number) {
    return Number.parseInt((value ?? fallback) as string, 10) || fallback;
}

function avatarHistoryTableName(userId: unknown) {
    return `${normalizeUserTablePrefix(userId)}_avatar_history`;
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

async function addAvatarToCache(entry: AvatarCacheInput) {
    return sqliteRepository.executeNonQuery(
        `INSERT OR REPLACE INTO cache_avatar (id, added_at, author_id, author_name, created_at, description, image_url, name, release_status, thumbnail_image_url, updated_at, version) VALUES (@id, @added_at, @author_id, @author_name, @created_at, @description, @image_url, @name, @release_status, @thumbnail_image_url, @updated_at, @version)`,
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

async function getCachedAvatarById(id: unknown) {
    const normalizedId = normalizeId(id);
    if (!normalizedId) {
        return null;
    }

    const rows = await sqliteRepository.query<SQLiteRow>(
        'SELECT * FROM cache_avatar WHERE id = @id LIMIT 1',
        {
            '@id': normalizedId
        }
    );
    return Array.isArray(rows) && rows.length
        ? normalizeAvatarCacheRow(rows[0])
        : null;
}

async function getAvatarCache() {
    const rows = await sqliteRepository.query<SQLiteRow>(
        'SELECT * FROM cache_avatar'
    );
    return Array.isArray(rows) ? rows.map(normalizeAvatarCacheRow) : [];
}

async function removeAvatarFromCache(avatarId: unknown) {
    const normalizedAvatarId = normalizeId(avatarId);
    if (!normalizedAvatarId) {
        return;
    }
    await sqliteRepository.executeNonQuery(
        'DELETE FROM cache_avatar WHERE id = @avatar_id',
        {
            '@avatar_id': normalizedAvatarId
        }
    );
}

async function addAvatarToHistory(userId: unknown, avatarId: unknown) {
    const normalizedAvatarId = normalizeId(avatarId);
    if (!normalizedAvatarId) {
        return;
    }

    await sqliteRepository.executeNonQuery(
        `INSERT INTO ${avatarHistoryTableName(userId)} (avatar_id, created_at, time)
         VALUES (@avatar_id, @created_at, 0)
         ON CONFLICT(avatar_id) DO UPDATE SET created_at = @created_at`,
        {
            '@avatar_id': normalizedAvatarId,
            '@created_at': new Date().toJSON()
        }
    );
}

async function addAvatarTimeSpent(
    userId: unknown,
    avatarId: unknown,
    timeSpent: unknown
) {
    const normalizedAvatarId = normalizeId(avatarId);
    const normalizedTimeSpent = parseInteger(timeSpent, 0);
    if (!normalizedAvatarId) {
        return;
    }

    await sqliteRepository.executeNonQuery(
        `INSERT INTO ${avatarHistoryTableName(userId)} (avatar_id, created_at, time)
         VALUES (@avatarId, @createdAt, @timeSpent)
         ON CONFLICT(avatar_id) DO UPDATE SET time = time + @timeSpent`,
        {
            '@avatarId': normalizedAvatarId,
            '@createdAt': new Date().toJSON(),
            '@timeSpent': normalizedTimeSpent
        }
    );
}

async function getAvatarTimeSpent(userId: unknown, avatarId: unknown) {
    const normalizedAvatarId = normalizeId(avatarId);
    const ref = {
        timeSpent: 0,
        avatarId: normalizedAvatarId
    };
    if (!normalizedAvatarId) {
        return ref;
    }

    await sqliteRepository.execute<unknown[]>(
        (row) => {
            ref.timeSpent = parseInteger(row[0], 0);
        },
        `SELECT time FROM ${avatarHistoryTableName(userId)} WHERE avatar_id = @avatarId`,
        {
            '@avatarId': normalizedAvatarId
        }
    );
    return ref;
}

async function getAllAvatarTimeSpent(userId: unknown) {
    const map = new Map<unknown, number>();
    await sqliteRepository.execute<unknown[]>(
        (row) => {
            map.set(row[0], parseInteger(row[1], 0));
        },
        `SELECT avatar_id, time FROM ${avatarHistoryTableName(userId)}`
    );
    return map;
}

async function getAvatarHistory(userId: unknown, limit: unknown = 100) {
    const tableName = avatarHistoryTableName(userId);
    const rows = await sqliteRepository.query<SQLiteRow>(
        `SELECT cache_avatar.*
         FROM ${tableName}
         INNER JOIN cache_avatar ON cache_avatar.id = ${tableName}.avatar_id
         WHERE author_id != @currentUserId
         ORDER BY ${tableName}.created_at DESC
         LIMIT @limit`,
        {
            '@currentUserId': normalizeId(userId),
            '@limit': parseInteger(limit, 100)
        }
    );
    return Array.isArray(rows) ? rows.map(normalizeAvatarCacheRow) : [];
}

async function clearAvatarHistory(userId: unknown) {
    await sqliteRepository.executeNonQuery(
        `DELETE FROM ${avatarHistoryTableName(userId)}`
    );
    await sqliteRepository.executeNonQuery('DELETE FROM cache_avatar');
}

async function getAvatarTags(avatarId: unknown) {
    const tags: AvatarTag[] = [];
    await sqliteRepository.execute(
        (row) => {
            tags.push({ tag: row[0], color: row[1] || null });
        },
        'SELECT tag, color FROM avatar_tags WHERE avatar_id = @avatar_id',
        {
            '@avatar_id': normalizeId(avatarId)
        }
    );
    return tags;
}

async function getAllAvatarTags() {
    const map = new Map<unknown, AvatarTag[]>();
    await sqliteRepository.execute((row) => {
        const avatarId = row[0];
        const tag = row[1];
        const color = row[2] || null;
        if (!map.has(avatarId)) {
            map.set(avatarId, []);
        }
        map.get(avatarId).push({ tag, color });
    }, 'SELECT avatar_id, tag, color FROM avatar_tags');
    return map;
}

async function getAllDistinctTags() {
    const tags: unknown[] = [];
    await sqliteRepository.execute((row) => {
        tags.push(row[0]);
    }, 'SELECT DISTINCT tag FROM avatar_tags ORDER BY tag');
    return tags;
}

async function addAvatarTag(avatarId: unknown, tag: unknown, color = null) {
    await sqliteRepository.executeNonQuery(
        'INSERT OR IGNORE INTO avatar_tags (avatar_id, tag, color) VALUES (@avatar_id, @tag, @color)',
        {
            '@avatar_id': normalizeId(avatarId),
            '@tag': asSQLiteValue(tag),
            '@color': asSQLiteValue(color)
        }
    );
}

async function updateAvatarTagColor(
    avatarId: unknown,
    tag: unknown,
    color: unknown
) {
    await sqliteRepository.executeNonQuery(
        'UPDATE avatar_tags SET color = @color WHERE avatar_id = @avatar_id AND tag = @tag',
        {
            '@avatar_id': normalizeId(avatarId),
            '@tag': asSQLiteValue(tag),
            '@color': asSQLiteValue(color)
        }
    );
}

async function removeAvatarTag(avatarId: unknown, tag: unknown) {
    await sqliteRepository.executeNonQuery(
        'DELETE FROM avatar_tags WHERE avatar_id = @avatar_id AND tag = @tag',
        {
            '@avatar_id': normalizeId(avatarId),
            '@tag': asSQLiteValue(tag)
        }
    );
}

async function removeAllAvatarTags(avatarId: unknown) {
    await sqliteRepository.executeNonQuery(
        'DELETE FROM avatar_tags WHERE avatar_id = @avatar_id',
        {
            '@avatar_id': normalizeId(avatarId)
        }
    );
}

const avatarLocalRepository = Object.freeze({
    addAvatarTag,
    addAvatarTimeSpent,
    addAvatarToCache,
    addAvatarToHistory,
    clearAvatarHistory,
    getAllAvatarTags,
    getAllAvatarTimeSpent,
    getAllDistinctTags,
    getAvatarCache,
    getAvatarHistory,
    getAvatarTags,
    getAvatarTimeSpent,
    getCachedAvatarById,
    removeAllAvatarTags,
    removeAvatarFromCache,
    removeAvatarTag,
    updateAvatarTagColor
});

export {
    addAvatarTag,
    addAvatarTimeSpent,
    addAvatarToCache,
    addAvatarToHistory,
    clearAvatarHistory,
    getAllAvatarTags,
    getAllAvatarTimeSpent,
    getAllDistinctTags,
    getAvatarCache,
    getAvatarHistory,
    getAvatarTags,
    getAvatarTimeSpent,
    getCachedAvatarById,
    removeAllAvatarTags,
    removeAvatarFromCache,
    removeAvatarTag,
    updateAvatarTagColor
};
export default avatarLocalRepository;
