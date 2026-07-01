import { bytesToBase64 } from './binary';

export interface ImageUploadValidationOptions {
    maxSize?: number;
}

export type ImageUploadValidationResult =
    | { ok: true; reason: '' }
    | { ok: false; reason: 'missing' | 'too_large' | 'not_image' };

const UPLOAD_TIMEOUT_MS = 30_000;
export const MAX_IMAGE_UPLOAD_BYTES = 20_000_000;
export const IMAGE_UPLOAD_ACCEPT =
    'image/png,image/jpeg,image/webp,image/gif,image/bmp';

const SAFE_RASTER_IMAGE_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'image/bmp'
]);

/**
 *
 */
export function withUploadTimeout<T>(promise: Promise<T>): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_: any, reject: any) => {
        timeoutId = setTimeout(
            () => reject(new Error('Upload timed out')),
            UPLOAD_TIMEOUT_MS
        );
    });
    return Promise.race<T>([promise, timeout]).finally(() => {
        clearTimeout(timeoutId);
    });
}

export async function readBlobAsBytes(blob: Blob): Promise<Uint8Array> {
    return new Uint8Array(await blob.arrayBuffer());
}

/**
 * File -> base64
 */
export async function readFileAsBase64(blob: Blob): Promise<string> {
    return bytesToBase64(await readBlobAsBytes(blob));
}

export function validateImageUploadFile(
    file: Blob | File | null | undefined,
    { maxSize = MAX_IMAGE_UPLOAD_BYTES }: ImageUploadValidationOptions = {}
): ImageUploadValidationResult {
    if (!file) {
        return { ok: false, reason: 'missing' };
    }

    if (file.size >= maxSize) {
        return { ok: false, reason: 'too_large' };
    }

    if (!SAFE_RASTER_IMAGE_TYPES.has(String(file.type || '').toLowerCase())) {
        return { ok: false, reason: 'not_image' };
    }

    return { ok: true, reason: '' };
}
