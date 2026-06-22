import { describe, expect, it } from 'vitest';

import removeConfusables, { removeWhitespace } from './confusables';

describe('confusables normalization', () => {
    it('returns printable ascii input unchanged on the fast path', () => {
        expect(removeConfusables('Maple_User-123')).toBe('Maple_User-123');
    });

    it('maps common mixed-script nickname confusables to their base characters', () => {
        expect(removeConfusables('Μарｌе⓿１')).toBe('Maple01');
    });

    it('removes combining marks, bidi controls, and whitespace before mapping', () => {
        expect(removeConfusables('M\u0301 a\u202Ep\u0301 l e')).toBe('Maple');
    });

    it('keeps whitespace removal available as a narrower helper', () => {
        expect(removeWhitespace('VR Chat\tName\n')).toBe('VRChatName');
    });
});
