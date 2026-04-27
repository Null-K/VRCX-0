import { check as checkTauriUpdater } from '@tauri-apps/plugin-updater';

import { storageRepository, webRepository } from '@/repositories/index.js';
import { branches } from '@/shared/constants/settings.js';
import {
    compareReleaseVersions,
    formatReleaseDisplayVersion,
    parseReleaseVersion
} from '@/shared/utils/releaseVersion.js';

const INSTALLABLE_PLATFORMS = new Set(['windows', 'linux']);
let updateInstallInFlight = null;

function channelIdForBranch(branch) {
    return String(sanitizeBranch(branch)).toLowerCase();
}

function platformIdForHost(hostPlatform) {
    return hostPlatform === 'linux'
        ? 'linux-x86_64'
        : hostPlatform === 'windows'
          ? 'windows-x86_64'
          : '';
}

function getUpdaterTarget(hostPlatform, branch) {
    const platformId = platformIdForHost(hostPlatform);
    return platformId ? `${platformId}-${channelIdForBranch(branch)}` : '';
}

function getUpdaterManifestAssetName(hostPlatform, branch) {
    const target = getUpdaterTarget(hostPlatform, branch);
    return target ? `vrcx-0-updater-${target}.json` : '';
}

function canInstallUpdatesOnPlatform(hostPlatform) {
    return INSTALLABLE_PLATFORMS.has(hostPlatform);
}

function getTauriManifestAssetOfInterest(assets = [], hostPlatform, branch) {
    const manifestName = getUpdaterManifestAssetName(hostPlatform, branch);
    if (!manifestName) {
        return null;
    }

    const asset = assets.find(
        (item) => item?.state === 'uploaded' && item.name === manifestName
    );
    if (!asset?.browser_download_url) {
        return null;
    }

    return {
        manifestUrl: asset.browser_download_url,
        target: getUpdaterTarget(hostPlatform, branch),
        updaterType: 'tauri'
    };
}

function normalizeGitHubRelease(
    release,
    { branch, hostPlatform = 'unknown', requireInstallerAsset = true } = {}
) {
    const parsedVersion = parseReleaseVersion(release?.tag_name);
    if (!parsedVersion) {
        return null;
    }

    const tauriAsset = getTauriManifestAssetOfInterest(
        release.assets,
        hostPlatform,
        branch || parsedVersion.channel
    );
    const asset = tauriAsset;
    if (requireInstallerAsset && !asset) {
        return null;
    }

    return {
        ...(asset || {}),
        canonicalVersion: parsedVersion.canonicalVersion,
        channel: parsedVersion.channel,
        displayVersion: parsedVersion.displayVersion,
        htmlUrl: release.html_url || '',
        tagName: release.tag_name,
        displayName: release.name || `VRCX-0 ${parsedVersion.displayVersion}`,
        prerelease: Boolean(release.prerelease),
        publishedAt: release.published_at || '',
        body: release.body || '',
        updaterType: asset?.updaterType || 'manual'
    };
}

function normalizeReleaseList(branch, releases, options = {}) {
    const normalizedBranch = sanitizeBranch(branch);
    const shouldKeepPrerelease = normalizedBranch !== 'Stable';
    return (Array.isArray(releases) ? releases : [releases])
        .map((release) =>
            normalizeGitHubRelease(release, {
                ...options,
                branch: normalizedBranch
            })
        )
        .filter(
            (release) =>
                release &&
                release.channel === normalizedBranch &&
                release.prerelease === shouldKeepPrerelease
        )
        .sort((left, right) =>
            compareReleaseVersions(
                right.canonicalVersion,
                left.canonicalVersion
            )
        );
}

function sanitizeBranch(branch) {
    if (branch === 'Alpha') {
        return 'Alpha';
    }
    return branch === 'Beta' ? 'Beta' : 'Stable';
}

function defaultBranchForVersion(version = VERSION || '') {
    return parseReleaseVersion(version)?.channel || 'Stable';
}

function hasUpdateForBranch(branch, currentVersion, latestReleaseVersion) {
    const currentParsed = parseReleaseVersion(currentVersion);
    const latestParsed = parseReleaseVersion(latestReleaseVersion);

    if (!currentParsed || !latestParsed) {
        return false;
    }

    const normalizedBranch = sanitizeBranch(branch);
    if (latestParsed.channel !== normalizedBranch) {
        return false;
    }

    if (normalizedBranch !== 'Stable') {
        const versionDelta =
            latestParsed.year - currentParsed.year ||
            latestParsed.month - currentParsed.month ||
            latestParsed.patchNumber - currentParsed.patchNumber;
        if (versionDelta !== 0) {
            return versionDelta > 0;
        }

        if (
            currentParsed.channel === 'Stable' &&
            latestParsed.channel === normalizedBranch
        ) {
            return true;
        }
    }

    return (
        compareReleaseVersions(latestParsed.canonicalVersion, currentParsed) > 0
    );
}

async function fetchBranchReleases(branch, options = {}) {
    const normalizedBranch = sanitizeBranch(branch);
    const response = await webRepository.execute({
        url: branches[normalizedBranch].urlReleases,
        method: 'GET',
        headers: {
            Accept: 'application/vnd.github+json'
        }
    });
    if (response.status && response.status !== 200) {
        throw new Error(`GitHub release request failed (${response.status}).`);
    }

    const data =
        typeof response.data === 'string'
            ? JSON.parse(response.data)
            : response.data;
    if (data?.message) {
        throw new Error(data.message);
    }

    return normalizeReleaseList(normalizedBranch, data, options);
}

async function fetchLatestBranchRelease(branch, options = {}) {
    const releases = await fetchBranchReleases(branch, options);
    return releases[0] || null;
}

async function getUpdaterProxy() {
    const proxy = await storageRepository
        .getString('VRCX_ProxyServer', '')
        .catch(() => '');
    return String(proxy || '').trim();
}

function shouldAllowDowngradesForBranch(branch) {
    return sanitizeBranch(branch) !== defaultBranchForVersion(VERSION || '');
}

async function buildTauriUpdaterCheckOptions(branch, hostPlatform) {
    if (!canInstallUpdatesOnPlatform(hostPlatform)) {
        throw new Error(`Updates are not installable on ${hostPlatform}.`);
    }

    const target = getUpdaterTarget(hostPlatform, branch);
    if (!target) {
        throw new Error('No Tauri updater target is available.');
    }

    const proxy = await getUpdaterProxy();
    return {
        target,
        allowDowngrades: shouldAllowDowngradesForBranch(branch),
        ...(proxy ? { proxy } : {})
    };
}

async function checkInstallableUpdate(
    branch,
    { hostPlatform = 'unknown' } = {}
) {
    if (!canInstallUpdatesOnPlatform(hostPlatform)) {
        return null;
    }

    const options = await buildTauriUpdaterCheckOptions(branch, hostPlatform);
    return checkTauriUpdater(options);
}

async function downloadAndInstallUpdate(release, options = {}) {
    if (updateInstallInFlight) {
        throw new Error('An update install is already in progress.');
    }
    const hostPlatform = options.hostPlatform || 'unknown';
    const branch = sanitizeBranch(options.branch || release?.channel);
    if (!release?.target) {
        throw new Error('Selected release has no Tauri updater target.');
    }

    updateInstallInFlight = (async () => {
        const checkOptions = await buildTauriUpdaterCheckOptions(
            branch,
            hostPlatform
        );
        const update = await checkTauriUpdater(checkOptions);
        if (!update) {
            throw new Error('No Tauri update is available.');
        }

        let downloaded = 0;
        let contentLength = 0;
        await update.downloadAndInstall((event) => {
            if (event.event === 'Started') {
                downloaded = 0;
                contentLength = Number(event.data.contentLength) || 0;
                options.onProgress?.(0);
                return;
            }
            if (event.event === 'Progress') {
                downloaded += Number(event.data.chunkLength) || 0;
                if (contentLength > 0) {
                    options.onProgress?.(
                        Math.min(
                            100,
                            Math.round((downloaded / contentLength) * 100)
                        )
                    );
                }
                return;
            }
            if (event.event === 'Finished') {
                options.onProgress?.(100);
            }
        });

        return update;
    })();

    try {
        return await updateInstallInFlight;
    } finally {
        updateInstallInFlight = null;
    }
}

export {
    canInstallUpdatesOnPlatform,
    checkInstallableUpdate,
    defaultBranchForVersion,
    downloadAndInstallUpdate,
    fetchBranchReleases,
    fetchLatestBranchRelease,
    formatReleaseDisplayVersion,
    getUpdaterManifestAssetName,
    getUpdaterTarget,
    hasUpdateForBranch,
    normalizeGitHubRelease,
    normalizeReleaseList,
    sanitizeBranch
};
