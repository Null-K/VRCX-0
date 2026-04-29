const RELEASE_CHANNELS = Object.freeze({
    STABLE: 'Stable',
    BETA: 'Beta',
    ALPHA: 'Alpha'
});

const MAX_RELEASE_NUMBER = 999;
const RELEASE_VERSION_PATTERN =
    /^v?(?<year>[1-9][0-9]{3})\.(?<month>0[1-9]|1[0-2])(?:\.(?<patch>[1-9][0-9]{0,2}))?(?:-(?<channel>alpha|beta)\.(?<number>[1-9][0-9]{0,2}))?$/;
const BUILD_VERSION_PATTERN =
    /^(?<year>[1-9][0-9]{3})\.(?<month>[1-9]|1[0-2])\.(?<patch>0|[1-9][0-9]{0,2})(?:-(?<channel>alpha|beta)\.(?<number>[1-9][0-9]{0,2}))?$/;

const CHANNEL_ORDER = {
    [RELEASE_CHANNELS.ALPHA]: 0,
    [RELEASE_CHANNELS.BETA]: 1,
    [RELEASE_CHANNELS.STABLE]: 2
};

const CHANNEL_BY_INPUT = new Map([
    ['stable', RELEASE_CHANNELS.STABLE],
    ['beta', RELEASE_CHANNELS.BETA],
    ['alpha', RELEASE_CHANNELS.ALPHA],
    [RELEASE_CHANNELS.STABLE, RELEASE_CHANNELS.STABLE],
    [RELEASE_CHANNELS.BETA, RELEASE_CHANNELS.BETA],
    [RELEASE_CHANNELS.ALPHA, RELEASE_CHANNELS.ALPHA]
]);

function normalizeReleaseChannel(channel) {
    return CHANNEL_BY_INPUT.get(String(channel || '').trim()) || null;
}

function isReleaseNumber(value) {
    return Number.isInteger(value) && value >= 1 && value <= MAX_RELEASE_NUMBER;
}

function parsePositiveReleaseNumber(value, label) {
    const stringValue = String(value || '');
    if (!/^[1-9][0-9]*$/.test(stringValue)) {
        throw new Error(`Invalid ${label}: ${value}`);
    }
    const parsedValue = Number.parseInt(stringValue, 10);
    if (!isReleaseNumber(parsedValue)) {
        throw new Error(`Invalid ${label}: ${value}`);
    }
    return parsedValue;
}

function formatReleaseBaseVersion({ year, month, patchNumber }) {
    return `${year}.${String(month).padStart(2, '0')}${
        patchNumber ? `.${patchNumber}` : ''
    }`;
}

function buildVersionInfo({ year, month, patchNumber, channel, number }) {
    const normalizedChannel =
        normalizeReleaseChannel(channel) || RELEASE_CHANNELS.STABLE;
    const alphaNumber =
        normalizedChannel === RELEASE_CHANNELS.ALPHA ? number : null;
    const betaNumber =
        normalizedChannel === RELEASE_CHANNELS.BETA ? number : null;
    const canonicalVersion = `${year}.${month}.${patchNumber}${
        alphaNumber
            ? `-alpha.${alphaNumber}`
            : betaNumber
              ? `-beta.${betaNumber}`
              : ''
    }`;
    const displayBaseVersion = formatReleaseBaseVersion({
        year,
        month,
        patchNumber
    });
    const displayVersion = alphaNumber
        ? `${displayBaseVersion}-alpha.${alphaNumber}`
        : `${displayBaseVersion}${betaNumber ? `-beta.${betaNumber}` : ''}`;

    return {
        year,
        month,
        patchNumber,
        betaNumber,
        alphaNumber,
        channel: normalizedChannel,
        buildVersion: canonicalVersion,
        canonicalVersion: displayVersion,
        displayVersion
    };
}

/**
 * @param {string} version
 * @returns {null | {
 *   year: number,
 *   month: number,
 *   patchNumber: number,
 *   betaNumber: number | null,
 *   alphaNumber: number | null,
 *   channel: 'Stable' | 'Beta' | 'Alpha',
 *   canonicalVersion: string,
 *   buildVersion: string,
 *   displayVersion: string
 * }}
 */
function parseReleaseVersion(version) {
    const normalizedVersion = String(version || '').trim();
    const match =
        RELEASE_VERSION_PATTERN.exec(normalizedVersion) ||
        BUILD_VERSION_PATTERN.exec(normalizedVersion);
    if (!match?.groups) {
        return null;
    }

    const year = Number.parseInt(match.groups.year, 10);
    const month = Number.parseInt(match.groups.month, 10);
    const patchNumber = match.groups.patch
        ? Number.parseInt(match.groups.patch, 10)
        : 0;
    const releaseNumber = match.groups.number
        ? Number.parseInt(match.groups.number, 10)
        : null;
    const channel = normalizeReleaseChannel(match.groups.channel);

    if (
        Number.isNaN(year) ||
        Number.isNaN(month) ||
        Number.isNaN(patchNumber) ||
        (match.groups.number && !isReleaseNumber(releaseNumber)) ||
        (channel && patchNumber !== 0)
    ) {
        return null;
    }

    return buildVersionInfo({
        year,
        month,
        patchNumber,
        channel: channel || RELEASE_CHANNELS.STABLE,
        number: releaseNumber
    });
}

function createReleaseVersionMeta({ baseVersion, channel, number }) {
    const baseParsed = parseReleaseVersion(baseVersion);
    const normalizedChannel = normalizeReleaseChannel(channel);
    if (!baseParsed) {
        throw new Error(`Invalid base version: ${baseVersion}`);
    }
    if (!normalizedChannel) {
        throw new Error(`Invalid channel: ${channel}`);
    }

    const base = buildVersionInfo({
        year: baseParsed.year,
        month: baseParsed.month,
        patchNumber: baseParsed.patchNumber,
        channel: RELEASE_CHANNELS.STABLE
    });

    if (normalizedChannel === RELEASE_CHANNELS.STABLE) {
        return {
            base_version: base.canonicalVersion,
            build_version: base.buildVersion,
            display_version: base.displayVersion,
            channel: RELEASE_CHANNELS.STABLE,
            prerelease: 'false',
            tag: `v${base.canonicalVersion}`
        };
    }

    if (base.patchNumber !== 0) {
        throw new Error(
            `${String(channel).toLowerCase()} releases must use a base patch version of 0: ${base.canonicalVersion}`
        );
    }

    const releaseNumber = parsePositiveReleaseNumber(
        number || '1',
        `${String(channel).toLowerCase()}_number`
    );
    const release = buildVersionInfo({
        year: base.year,
        month: base.month,
        patchNumber: base.patchNumber,
        channel: normalizedChannel,
        number: releaseNumber
    });

    return {
        base_version: base.canonicalVersion,
        build_version: release.buildVersion,
        display_version: release.displayVersion,
        channel: normalizedChannel,
        prerelease: 'true',
        tag: `v${release.canonicalVersion}`
    };
}

/**
 * @param {string} version
 * @returns {string}
 */
function formatReleaseDisplayVersion(version) {
    const parsedVersion = parseReleaseVersion(version);
    if (parsedVersion) {
        return parsedVersion.displayVersion;
    }

    return String(version || '').trim();
}

/**
 * @param {string | ReturnType<typeof parseReleaseVersion>} left
 * @param {string | ReturnType<typeof parseReleaseVersion>} right
 * @returns {number}
 */
function compareReleaseVersions(left, right) {
    const parsedLeft =
        typeof left === 'string' ? parseReleaseVersion(left) : left;
    const parsedRight =
        typeof right === 'string' ? parseReleaseVersion(right) : right;

    if (!parsedLeft && !parsedRight) {
        return 0;
    }
    if (!parsedLeft) {
        return -1;
    }
    if (!parsedRight) {
        return 1;
    }

    const versionDelta =
        parsedLeft.year - parsedRight.year ||
        parsedLeft.month - parsedRight.month ||
        parsedLeft.patchNumber - parsedRight.patchNumber;
    if (versionDelta !== 0) {
        return versionDelta;
    }

    if (parsedLeft.channel !== parsedRight.channel) {
        return (
            CHANNEL_ORDER[parsedLeft.channel] -
            CHANNEL_ORDER[parsedRight.channel]
        );
    }

    return (
        (parsedLeft.alphaNumber || parsedLeft.betaNumber || 0) -
        (parsedRight.alphaNumber || parsedRight.betaNumber || 0)
    );
}

export {
    compareReleaseVersions,
    createReleaseVersionMeta,
    formatReleaseDisplayVersion,
    parseReleaseVersion
};
