import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { UserStatusDot } from './UserStatusDot';

describe('UserStatusDot', () => {
    it('renders active avatar dots as the shared nested ring', () => {
        const html = renderToStaticMarkup(
            <UserStatusDot
                statusDotClassName="border-[var(--status-online)] bg-background"
                className="absolute size-3.75"
            />
        );

        expect(html).toContain('border-3');
        expect(html).toContain('absolute inset-0 rounded-full border-2');
        expect(html).toContain('border-[var(--status-online)]');
        expect(html).toContain('bg-background');
        expect(html).not.toContain('relative');
    });

    it('renders nothing without a status class', () => {
        expect(renderToStaticMarkup(<UserStatusDot />)).toBe('');
    });
});
