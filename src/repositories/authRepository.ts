import { asString, safeJsonStringify } from './baseRepository.js';
import configRepository from './configRepository.js';
import webRepository from './webRepository.js';

type GenericRecord = Record<string, unknown>;

interface LoginParams {
    username: string;
    password: string;
    endpoint: string;
    websocket: string;
}

interface RawSavedCredentialRecord extends GenericRecord {
    user?: GenericRecord;
    loginParams?: GenericRecord;
    loginParmas?: GenericRecord;
    cookies?: unknown;
}

interface SavedCredentialRecord {
    user: GenericRecord;
    loginParams: LoginParams;
    cookies?: unknown;
}

type SavedCredentialsMap = Record<string, SavedCredentialRecord>;

const MAX_AUTO_LOGIN_DELAY_SECONDS = 10;

interface RecordLoginSuccessInput {
    user?: GenericRecord;
    loginParams?: GenericRecord;
    storedLoginParams?: GenericRecord | null;
    saveCredentials?: boolean;
}

interface RecordLogoutOptions {
    clearLastUserLoggedIn?: unknown;
    cookies?: unknown;
}

function normalizeLoginParams(entry: RawSavedCredentialRecord): LoginParams {
    const rawLoginParams = entry?.loginParams ?? entry?.loginParmas ?? {};

    return {
        username: asString(rawLoginParams.username, ''),
        password: asString(rawLoginParams.password, ''),
        endpoint: asString(rawLoginParams.endpoint, ''),
        websocket: asString(rawLoginParams.websocket, '')
    };
}

function normalizeSavedCredentialRecord(key: string, entry: unknown) {
    if (
        !entry ||
        typeof entry !== 'object' ||
        !(entry as RawSavedCredentialRecord).user ||
        typeof (entry as RawSavedCredentialRecord).user !== 'object'
    ) {
        return { edited: false, normalizedKey: null, value: null };
    }

    const record = entry as RawSavedCredentialRecord;
    const user = record.user as GenericRecord;
    const userId = asString(user.id, key).trim();
    if (!userId) {
        return { edited: false, normalizedKey: null, value: null };
    }

    const normalizedValue: SavedCredentialRecord = {
        user,
        loginParams: normalizeLoginParams(record)
    };

    if (
        record.cookies !== undefined &&
        record.cookies !== null &&
        record.cookies !== ''
    ) {
        normalizedValue.cookies = record.cookies;
    }

    const hasEndpointField = Object.prototype.hasOwnProperty.call(
        record.loginParams ?? {},
        'endpoint'
    );
    const hasWebsocketField = Object.prototype.hasOwnProperty.call(
        record.loginParams ?? {},
        'websocket'
    );
    const edited =
        userId !== key ||
        Boolean(record.loginParmas) ||
        !hasEndpointField ||
        !hasWebsocketField;

    return {
        edited,
        normalizedKey: userId,
        value: normalizedValue
    };
}

function sortSavedCredentials(
    savedCredentials: SavedCredentialsMap,
    lastUserLoggedIn: unknown
) {
    return Object.values(savedCredentials).sort((left, right) => {
        const leftIsLast = left.user?.id === lastUserLoggedIn;
        const rightIsLast = right.user?.id === lastUserLoggedIn;

        if (leftIsLast !== rightIsLast) {
            return leftIsLast ? -1 : 1;
        }

        const leftName = asString(
            left.user?.displayName || left.user?.username,
            ''
        ).toLowerCase();
        const rightName = asString(
            right.user?.displayName || right.user?.username,
            ''
        ).toLowerCase();
        return leftName.localeCompare(rightName);
    });
}

function normalizeAutoLoginDelaySeconds(value: unknown): number {
    const parsed =
        typeof value === 'number'
            ? value
            : Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed)) {
        return 0;
    }
    return Math.min(
        MAX_AUTO_LOGIN_DELAY_SECONDS,
        Math.max(0, Math.trunc(parsed))
    );
}

function resolveAutoLoginStatus({
    lastUserLoggedIn,
    savedCredentials,
    autoLoginDelayEnabled,
    autoLoginDelaySeconds
}: {
    lastUserLoggedIn: unknown;
    savedCredentials: SavedCredentialsMap;
    autoLoginDelayEnabled: unknown;
    autoLoginDelaySeconds: number;
}) {
    if (!lastUserLoggedIn) {
        return {
            status: 'not-configured',
            reason: 'No previous login was recorded.'
        };
    }

    const savedCredential = savedCredentials[String(lastUserLoggedIn)];
    if (!savedCredential) {
        return {
            status: 'missing-last-user',
            reason: 'The last logged-in account is no longer present in saved credentials.'
        };
    }

    if (
        !savedCredential.loginParams.username ||
        !savedCredential.loginParams.password
    ) {
        return {
            status: 'missing-credentials',
            reason: 'The saved account is missing username or password data.'
        };
    }

    if (autoLoginDelayEnabled && autoLoginDelaySeconds > 0) {
        return {
            status: 'available',
            reason: `Saved credentials are available. Auto-login delay is ${autoLoginDelaySeconds} second(s).`
        };
    }

    return {
        status: 'available',
        reason: 'Saved credentials are available and auto-login can run immediately.'
    };
}

async function getSavedCredentialsMap() {
    const rawSavedCredentials = await configRepository.getObject(
        'savedCredentials',
        {}
    );
    const source =
        rawSavedCredentials && typeof rawSavedCredentials === 'object'
            ? (rawSavedCredentials as Record<string, unknown>)
            : {};

    const normalized: SavedCredentialsMap = {};
    let edited = false;

    for (const [key, value] of Object.entries(source)) {
        const normalizedRecord = normalizeSavedCredentialRecord(key, value);
        if (!normalizedRecord.normalizedKey || !normalizedRecord.value) {
            edited = true;
            continue;
        }

        normalized[normalizedRecord.normalizedKey] = normalizedRecord.value;
        edited = edited || normalizedRecord.edited;
    }

    if (edited || safeJsonStringify(source) !== safeJsonStringify(normalized)) {
        await configRepository.setObject('savedCredentials', normalized);
    }

    return normalized;
}

async function getSavedCredential(userId: string) {
    if (!userId) {
        return null;
    }

    const savedCredentials = await getSavedCredentialsMap();
    return savedCredentials[userId] ?? null;
}

async function deleteSavedCredential(userId: string) {
    const savedCredentials = await getSavedCredentialsMap();
    delete savedCredentials[userId];
    await configRepository.setObject('savedCredentials', savedCredentials);

    const lastUserLoggedIn = await configRepository.getString(
        'lastUserLoggedIn',
        null
    );
    if (lastUserLoggedIn === userId) {
        await configRepository.remove('lastUserLoggedIn');
    }

    return getSavedAuthSnapshot();
}

async function setCustomEndpointEnabled(value: unknown) {
    await configRepository.setBool('enableCustomEndpoint', Boolean(value));
    return getSavedAuthSnapshot();
}

async function recordLoginSuccess({
    user,
    loginParams = {},
    storedLoginParams = null,
    saveCredentials = false
}: RecordLoginSuccessInput) {
    const userId = asString(user?.id, '').trim();
    if (!userId) {
        throw new Error('AuthRepository.recordLoginSuccess requires a user id');
    }

    const savedCredentials = await getSavedCredentialsMap();
    const existingRecord = savedCredentials[userId] ?? null;

    if (saveCredentials) {
        savedCredentials[userId] = {
            user,
            loginParams: normalizeLoginParams({
                loginParams: storedLoginParams ?? loginParams
            })
        };
        delete savedCredentials[userId].cookies;
    } else if (existingRecord) {
        savedCredentials[userId] = {
            ...existingRecord,
            user
        };
        const cookies = await webRepository.getCookies();
        if (cookies !== undefined && cookies !== null && cookies !== '') {
            savedCredentials[userId].cookies = cookies;
        } else {
            delete savedCredentials[userId].cookies;
        }
    }

    await configRepository.setObject('savedCredentials', savedCredentials);
    await configRepository.setString('lastUserLoggedIn', userId);
    return getSavedAuthSnapshot();
}

async function recordLogout(
    userOrUserId: GenericRecord | string | null,
    options: RecordLogoutOptions = {}
) {
    const user: GenericRecord | null =
        userOrUserId && typeof userOrUserId === 'object' ? userOrUserId : null;
    const userId = asString(user?.id ?? userOrUserId, '').trim();
    const clearLastUserLoggedIn =
        options.clearLastUserLoggedIn !== undefined
            ? Boolean(options.clearLastUserLoggedIn)
            : Boolean(userId);
    if (userId) {
        const savedCredentials = await getSavedCredentialsMap();
        if (savedCredentials[userId]) {
            if (user) {
                savedCredentials[userId] = {
                    ...savedCredentials[userId],
                    user
                };
            }

            const cookies =
                options.cookies !== undefined
                    ? options.cookies
                    : await webRepository.getCookies();
            if (cookies !== undefined && cookies !== null && cookies !== '') {
                savedCredentials[userId].cookies = cookies;
            } else {
                delete savedCredentials[userId].cookies;
            }

            await configRepository.setObject(
                'savedCredentials',
                savedCredentials
            );
        }
    }

    if (clearLastUserLoggedIn) {
        await configRepository.remove('lastUserLoggedIn');
    }
    return getSavedAuthSnapshot();
}

async function getSavedAuthSnapshot() {
    let [
        savedCredentials,
        lastUserLoggedIn,
        legacyPrimaryPasswordEnabled,
        enableCustomEndpoint,
        autoLoginDelayEnabled,
        autoLoginDelaySeconds
    ] = await Promise.all([
        getSavedCredentialsMap(),
        configRepository.getString('lastUserLoggedIn', null),
        configRepository.getBool('enablePrimaryPassword', false),
        configRepository.getBool('enableCustomEndpoint', false),
        configRepository.getBool('autoLoginDelayEnabled', false),
        configRepository.getInt('autoLoginDelaySeconds', 0)
    ]);

    if (legacyPrimaryPasswordEnabled) {
        savedCredentials = {};
        lastUserLoggedIn = null;
        await configRepository.setMany([['savedCredentials', '{}']]);
        await configRepository.remove('enablePrimaryPassword');
        await configRepository.remove('lastUserLoggedIn');
    }

    const normalizedAutoLoginDelaySeconds =
        normalizeAutoLoginDelaySeconds(autoLoginDelaySeconds);
    const autoLogin = resolveAutoLoginStatus({
        lastUserLoggedIn,
        savedCredentials,
        autoLoginDelayEnabled,
        autoLoginDelaySeconds: normalizedAutoLoginDelaySeconds
    });

    return {
        lastUserLoggedIn,
        savedCredentialCount: Object.keys(savedCredentials).length,
        savedCredentials,
        savedCredentialsList: sortSavedCredentials(
            savedCredentials,
            lastUserLoggedIn
        ),
        enableCustomEndpoint: Boolean(enableCustomEndpoint),
        autoLoginDelayEnabled: Boolean(autoLoginDelayEnabled),
        autoLoginDelaySeconds: normalizedAutoLoginDelaySeconds,
        autoLoginStatus: autoLogin.status,
        autoLoginReason: autoLogin.reason
    };
}

const authRepository = Object.freeze({
    getSavedCredentialsMap,
    getSavedCredential,
    deleteSavedCredential,
    setCustomEndpointEnabled,
    recordLoginSuccess,
    recordLogout,
    getSavedAuthSnapshot
});

export {
    getSavedCredentialsMap,
    getSavedCredential,
    deleteSavedCredential,
    setCustomEndpointEnabled,
    recordLoginSuccess,
    recordLogout,
    getSavedAuthSnapshot
};
export default authRepository;
