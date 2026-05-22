import { describe, expect, it } from 'vitest';

import {
    MODERATION_DEFAULT_SORTING,
    sanitizeModerationSorting
} from './moderationPageState';

describe('moderationPageState', () => {
    it('drops source and target from saved sorting state', () => {
        expect(
            sanitizeModerationSorting([
                { id: 'sourceDisplayName', desc: false },
                { id: 'created', desc: true },
                { id: 'targetDisplayName', desc: false },
                { id: 'type', desc: false }
            ])
        ).toEqual([
            { id: 'created', desc: true },
            { id: 'type', desc: false }
        ]);

        expect(
            sanitizeModerationSorting([
                { id: 'sourceDisplayName', desc: false },
                { id: 'targetDisplayName', desc: true }
            ])
        ).toBe(MODERATION_DEFAULT_SORTING);
    });
});
