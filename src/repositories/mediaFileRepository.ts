import { normalizePlatformError } from '@/platform/tauri/errors.js';
import { backend } from '@/platform/tauri/index.js';
import { safeJsonParse } from '@/repositories/baseRepository.js';

type AppCommandName = string;

function parseResponseValue(data: unknown): unknown {
    if (data === null || data === undefined || data === '') {
        return data ?? null;
    }

    if (typeof data !== 'string') {
        return data;
    }

    return safeJsonParse(data, data);
}

async function invokeApp(methodName: AppCommandName, ...args: unknown[]) {
    try {
        return await backend.app[methodName](...args);
    } catch (error) {
        throw normalizePlatformError(
            error,
            `App command failed: ${methodName}`
        );
    }
}

async function resizeImageToFitLimits(base64Body: string) {
    return invokeApp('ResizeImageToFitLimits', base64Body);
}

async function getFileBase64(path: string) {
    return invokeApp('GetFileBase64', path);
}

async function getScreenshotMetadata(path: string) {
    return parseResponseValue(await invokeApp('GetScreenshotMetadata', path));
}

async function deleteScreenshotMetadata(path: string) {
    return invokeApp('DeleteScreenshotMetadata', path);
}

async function addScreenshotMetadata(
    path: string,
    metadataString: string,
    worldId: string,
    changeFilename = false
) {
    return invokeApp(
        'AddScreenshotMetadata',
        path,
        metadataString,
        worldId,
        changeFilename
    );
}

async function getExtraScreenshotData(path: string, carouselCache = false) {
    return parseResponseValue(
        await invokeApp('GetExtraScreenshotData', path, carouselCache)
    );
}

async function findScreenshotsBySearch(
    searchQuery: string,
    searchType: string
) {
    return parseResponseValue(
        await invokeApp('FindScreenshotsBySearch', searchQuery, searchType)
    );
}

async function getLastScreenshot() {
    return invokeApp('GetLastScreenshot');
}

async function getVrchatPhotosLocation() {
    return invokeApp('GetVrchatPhotosLocation');
}

async function getUgcPhotoLocation(path = '') {
    return invokeApp('GetUGCPhotoLocation', path);
}

async function openFileSelectorDialog(
    defaultPath = '',
    defaultExt = '',
    defaultFilter = ''
) {
    return invokeApp(
        'OpenFileSelectorDialog',
        defaultPath,
        defaultExt,
        defaultFilter
    );
}

async function openFolderAndSelectItem(path: string, isFolder = false) {
    return invokeApp('OpenFolderAndSelectItem', path, isFolder);
}

async function copyImageToClipboard(path: string) {
    return invokeApp('CopyImageToClipboard', path);
}

async function saveImageFile(defaultName: string, base64Data: string) {
    return invokeApp('SaveImageFile', defaultName, base64Data);
}

async function savePrintToFile(
    url: string,
    ugcFolderPath: string,
    monthFolder: string,
    fileName: string
) {
    return invokeApp(
        'SavePrintToFile',
        url,
        ugcFolderPath,
        monthFolder,
        fileName
    );
}

async function saveStickerToFile(
    url: string,
    ugcFolderPath: string,
    monthFolder: string,
    fileName: string
) {
    return invokeApp(
        'SaveStickerToFile',
        url,
        ugcFolderPath,
        monthFolder,
        fileName
    );
}

async function saveEmojiToFile(
    url: string,
    ugcFolderPath: string,
    monthFolder: string,
    fileName: string
) {
    return invokeApp(
        'SaveEmojiToFile',
        url,
        ugcFolderPath,
        monthFolder,
        fileName
    );
}

async function cropPrintImage(path: string) {
    return invokeApp('CropPrintImage', path);
}

async function cropAllPrints(ugcFolderPath: string) {
    return invokeApp('CropAllPrints', ugcFolderPath);
}

const mediaFileRepository = Object.freeze({
    invokeApp,
    resizeImageToFitLimits,
    getFileBase64,
    getScreenshotMetadata,
    deleteScreenshotMetadata,
    addScreenshotMetadata,
    getExtraScreenshotData,
    findScreenshotsBySearch,
    getLastScreenshot,
    getVrchatPhotosLocation,
    getUgcPhotoLocation,
    openFileSelectorDialog,
    openFolderAndSelectItem,
    copyImageToClipboard,
    saveImageFile,
    savePrintToFile,
    saveStickerToFile,
    saveEmojiToFile,
    cropPrintImage,
    cropAllPrints
});

export {
    invokeApp,
    resizeImageToFitLimits,
    getFileBase64,
    getScreenshotMetadata,
    deleteScreenshotMetadata,
    addScreenshotMetadata,
    getExtraScreenshotData,
    findScreenshotsBySearch,
    getLastScreenshot,
    getVrchatPhotosLocation,
    getUgcPhotoLocation,
    openFileSelectorDialog,
    openFolderAndSelectItem,
    copyImageToClipboard,
    saveImageFile,
    savePrintToFile,
    saveStickerToFile,
    saveEmojiToFile,
    cropPrintImage,
    cropAllPrints
};

export default mediaFileRepository;
