import { describe, expect, it } from 'vitest';

import { computeCropRect, isNoopCrop } from './imageCropUtils';

describe('computeCropRect', () => {
    it('returns preview-space pixels unchanged when previewScale is 1', () => {
        expect(
            computeCropRect({ x: 10, y: 20, width: 300, height: 200 }, 1)
        ).toEqual({ x: 10, y: 20, width: 300, height: 200 });
    });

    it('maps downscaled preview pixels back to original resolution', () => {
        // large image downscaled to 25% for preview
        expect(
            computeCropRect({ x: 50, y: 100, width: 200, height: 150 }, 0.25)
        ).toEqual({ x: 200, y: 400, width: 800, height: 600 });
    });

    it('rounds fractional results', () => {
        expect(
            computeCropRect({ x: 3, y: 3, width: 10, height: 10 }, 0.3)
        ).toEqual({ x: 10, y: 10, width: 33, height: 33 });
    });
});

describe('isNoopCrop', () => {
    it('is true when the crop covers the whole image', () => {
        expect(
            isNoopCrop({ x: 0, y: 0, width: 1920, height: 1080 }, 1920, 1080)
        ).toBe(true);
    });

    it('tolerates 1px rounding drift on origin and size', () => {
        expect(
            isNoopCrop({ x: 1, y: 1, width: 1921, height: 1079 }, 1920, 1080)
        ).toBe(true);
    });

    it('is false when the crop is inset from the origin', () => {
        expect(
            isNoopCrop({ x: 100, y: 0, width: 1820, height: 1080 }, 1920, 1080)
        ).toBe(false);
    });

    it('is false when the crop is smaller than the image', () => {
        expect(
            isNoopCrop({ x: 0, y: 0, width: 960, height: 540 }, 1920, 1080)
        ).toBe(false);
    });
});
