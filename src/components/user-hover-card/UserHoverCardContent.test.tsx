import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const hoverCardData = vi.hoisted(() => ({
    model: {
        variant: 'profile-only',
        displayName: 'Alice',
        avatarUrl: '',
        avatarPreviewUrl: '',
        userColour: '',
        trustSource: {},
        trustKey: '',
        statusKey: '',
        statusDotClassName: '',
        statusDescription: '',
        note: '',
        onlineForMs: 0,
        instanceEpoch: 0,
        lastOnlineAgoMs: 0,
        location: {
            effectiveLocation: '',
            worldId: '',
            instanceId: '',
            tag: '',
            accessTypeName: '',
            isRealInstance: false,
            isTraveling: false
        }
    }
}));

vi.mock('react-i18next', () => ({
    initReactI18next: {
        type: '3rdParty',
        init: () => {}
    },
    useTranslation: () => ({
        t: (key: string) => key
    })
}));

vi.mock('@/services/dialogService', () => ({
    openUserDialog: vi.fn(),
    openWorldDialog: vi.fn()
}));

vi.mock('./useUserHoverCardData', () => ({
    useUserHoverCardData: () => ({
        model: hoverCardData.model,
        worldThumb: '',
        population: null,
        populationLoading: false,
        memo: '',
        trustColor: false,
        instanceEpoch: 0
    })
}));

import { UserHoverCardContent } from './UserHoverCardContent';

describe('UserHoverCardContent', () => {
    it('does not render an online status dot for profile-only cards', () => {
        hoverCardData.model.statusKey = '';
        hoverCardData.model.statusDotClassName = '';
        const html = renderToStaticMarkup(
            <UserHoverCardContent userId="usr_1" />
        );

        expect(html).not.toContain('status-online');
    });

    it('renders active status dots with the sidebar ring style', () => {
        hoverCardData.model.statusKey = 'active';
        hoverCardData.model.statusDotClassName =
            'border-[var(--status-online)] bg-background';

        const html = renderToStaticMarkup(
            <UserHoverCardContent userId="usr_1" />
        );

        expect(html).toContain('border-3');
        expect(html).toContain('border-[var(--status-online)]');
        expect(html).toContain('bg-background');
        expect(html).toContain('dialog.user.status.active');
    });
});
