/* global __dirname, process, require */

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const rootDir = path.join(__dirname, '..');
const tauriConfigPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json');
const cargoTomlPath = path.join(rootDir, 'src-tauri', 'Cargo.toml');
const cargoLockPath = path.join(rootDir, 'src-tauri', 'Cargo.lock');
const releaseVersionCorePath = path.join(
    rootDir,
    'src',
    'shared',
    'utils',
    'releaseVersionCore.mjs'
);

function readArg(argName, fallback = '') {
    const prefix = `--${argName}=`;
    const inline = process.argv.find((arg) => arg.startsWith(prefix));
    if (inline) {
        return inline.slice(prefix.length);
    }

    const index = process.argv.indexOf(`--${argName}`);
    if (index >= 0 && index + 1 < process.argv.length) {
        return process.argv[index + 1];
    }

    return fallback;
}

function readBaseVersion() {
    const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, 'utf8'));
    return String(tauriConfig.version || '').trim();
}

async function buildReleaseMeta() {
    const channel = readArg('channel', 'stable');
    const { createReleaseVersionMeta } = await import(
        pathToFileURL(releaseVersionCorePath).href
    );

    return createReleaseVersionMeta({
        baseVersion: readBaseVersion(),
        channel,
        number: readArg(`${String(channel).toLowerCase()}-number`, '1')
    });
}

function syncVersionToManifests(buildVersion) {
    const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, 'utf8'));
    tauriConfig.version = buildVersion;
    fs.writeFileSync(
        tauriConfigPath,
        `${JSON.stringify(tauriConfig, null, 4)}\n`
    );

    const cargoToml = fs.readFileSync(cargoTomlPath, 'utf8');
    const cargoVersionPattern = /(^\[package\][\s\S]*?^version\s*=\s*)"[^"]+"/m;
    if (!cargoVersionPattern.test(cargoToml)) {
        throw new Error(
            'Failed to update src-tauri/Cargo.toml package version'
        );
    }
    fs.writeFileSync(
        cargoTomlPath,
        cargoToml.replace(cargoVersionPattern, `$1"${buildVersion}"`)
    );

    if (!fs.existsSync(cargoLockPath)) {
        return;
    }

    const cargoLock = fs.readFileSync(cargoLockPath, 'utf8');
    const lockVersionPattern =
        /(\[\[package\]\]\r?\nname = "vrcx-0"\r?\nversion = )"[^"]+"/;
    if (!lockVersionPattern.test(cargoLock)) {
        throw new Error(
            'Failed to update src-tauri/Cargo.lock package version'
        );
    }
    fs.writeFileSync(
        cargoLockPath,
        cargoLock.replace(lockVersionPattern, `$1"${buildVersion}"`)
    );
}

function writeOutputs(meta) {
    const lines = Object.entries(meta).map(([key, value]) => `${key}=${value}`);
    for (const line of lines) {
        console.log(line);
    }

    if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
    }
}

buildReleaseMeta()
    .then((meta) => {
        syncVersionToManifests(meta.build_version);
        writeOutputs(meta);
    })
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
