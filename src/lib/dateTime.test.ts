import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_TIME_UNIT_LABELS } from '@/shared/utils/dateTime';
import { useShellStore } from '@/state/shellStore';

import { formatRelativeTime, timeToText } from './dateTime';

const NOW = new Date('2026-06-22T12:00:00Z').getTime();

describe('app dateTime wrappers', () => {
    beforeEach(() => {
        useShellStore.setState({
            locale: 'en',
            dateCulture: 'en-gb',
            dateHour12: false,
            timeUnitLabels: DEFAULT_TIME_UNIT_LABELS
        });
    });

    it('formats relative time through the current shell locale', () => {
        useShellStore.setState({ locale: 'zh-CN' });
        const value = new Date(NOW - 2 * 60 * 60 * 1000).toISOString();
        const expected = new Intl.RelativeTimeFormat('zh-CN', {
            numeric: 'auto',
            style: 'long'
        }).format(-2, 'hour');

        expect(formatRelativeTime(value, { nowMs: NOW })).toBe(expected);
    });

    it('returns relative-time fallback for empty and invalid values', () => {
        expect(formatRelativeTime('', { fallback: 'missing' })).toBe('missing');
        expect(formatRelativeTime('not-a-date', { fallback: 'invalid' })).toBe(
            'invalid'
        );
    });

    it('formats millisecond durations with stable unit boundaries', () => {
        expect(timeToText(0)).toBe('0s');
        expect(timeToText(90_000)).toBe('1m');
        expect(timeToText(90_000, true)).toBe('1m 30s');
        expect(timeToText(3_661_000, true)).toBe('1h 1m 0s');
        expect(timeToText(-86_400_000)).toBe('1d');
        expect(timeToText('not-a-number')).toBe('not-a-number');
    });

    it('uses shell-provided duration labels unless explicit labels are passed', () => {
        useShellStore.getState().setTimeUnitLabels({
            h: ' hours',
            m: ' minutes',
            s: ' seconds'
        });

        expect(timeToText(3_600_000)).toBe('1 hours');
        expect(timeToText(65_000, true)).toBe('1 minutes 5 seconds');
        expect(timeToText(65_000, true, { m: 'm', s: 's' })).toBe('1m 5s');
    });
});
