/* global process, require */

const fs = require('node:fs');
const path = require('node:path');

const REPO_RELEASE_DOWNLOAD_BASE =
    'https://github.com/Map1en/VRCX-0/releases/download';

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

function requireArg(argName) {
    const value = readArg(argName).trim();
    if (!value) {
        throw new Error(`Missing required argument: --${argName}`);
    }
    return value;
}

function validateTarget(target) {
    if (/^(linux|windows)-x86_64-(stable|beta|alpha)$/.test(target) === false) {
        throw new Error(`Invalid updater target: ${target}`);
    }
}

function readNotes(notesFile) {
    if (!notesFile) {
        return '';
    }
    return fs.readFileSync(notesFile, 'utf8').trim();
}

function releaseAssetUrl(tag, assetName) {
    return `${REPO_RELEASE_DOWNLOAD_BASE}/${encodeURIComponent(tag)}/${encodeURIComponent(assetName)}`;
}

function main() {
    const version = requireArg('version');
    const tag = requireArg('tag');
    const target = requireArg('target');
    const assetName = requireArg('asset-name');
    const signatureFile = requireArg('signature-file');
    const out = requireArg('out');
    const notesFile = readArg('notes-file');

    validateTarget(target);

    const signature = fs.readFileSync(signatureFile, 'utf8').trim();
    if (!signature) {
        throw new Error(`Signature file is empty: ${signatureFile}`);
    }

    const manifest = {
        version,
        notes: readNotes(notesFile),
        pub_date: new Date().toISOString(),
        platforms: {
            [target]: {
                signature,
                url: releaseAssetUrl(tag, assetName)
            }
        }
    };

    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(manifest, null, 4)}\n`);
    console.log(out);
}

try {
    main();
} catch (error) {
    console.error(error);
    process.exitCode = 1;
}
