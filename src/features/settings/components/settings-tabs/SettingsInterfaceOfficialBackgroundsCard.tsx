import { ImageIcon, RefreshCwIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
    disableInstalledCommunityTheme,
    stopLocalCommunityThemePreview
} from '@/services/communityThemeService';
import {
    disableOfficialBackground,
    enableOfficialBackground,
    officialImageProviders,
    refreshOfficialBackground,
    setOfficialBackgroundProvider
} from '@/services/officialBackgroundService';
import type { OfficialBackgroundProviderId } from '@/services/official-background-providers/officialBackgroundProviderTypes';
import { useOfficialBackgroundStore } from '@/state/officialBackgroundStore';
import { Button } from '@/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Switch } from '@/ui/shadcn/switch';

import { Field } from '../SettingsField';

export function SettingsInterfaceOfficialBackgroundsCard() {
    const { t } = useTranslation();
    const enabled = useOfficialBackgroundStore((state: any) => state.enabled);
    const providerId = useOfficialBackgroundStore(
        (state: any) => state.providerId
    );
    const snapshot = useOfficialBackgroundStore((state: any) => state.snapshot);
    const loading = useOfficialBackgroundStore((state: any) => state.loading);

    async function enableBackground(nextProviderId = providerId) {
        try {
            const enabledBackground =
                await enableOfficialBackground(nextProviderId);
            if (!enabledBackground) {
                return;
            }
            await stopLocalCommunityThemePreview();
            await disableInstalledCommunityTheme();
            toast.success(t('view.official_backgrounds.toast.enabled'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.official_backgrounds.toast.failed')
            );
        }
    }

    async function disableBackground() {
        try {
            await disableOfficialBackground();
            toast.success(t('view.official_backgrounds.toast.disabled'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.official_backgrounds.toast.failed')
            );
        }
    }

    async function updateProvider(nextProviderId: OfficialBackgroundProviderId) {
        if (enabled) {
            await enableBackground(nextProviderId);
            return;
        }

        try {
            await setOfficialBackgroundProvider(nextProviderId);
            toast.success(t('common.settings_saved'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.official_backgrounds.toast.failed')
            );
        }
    }

    async function refreshBackground() {
        try {
            const refreshed = await refreshOfficialBackground();
            if (!refreshed) {
                return;
            }
            toast.success(t('view.official_backgrounds.toast.refreshed'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.official_backgrounds.toast.failed')
            );
        }
    }

    const statusLabel = enabled
        ? t('view.official_backgrounds.status.enabled')
        : t('view.official_backgrounds.status.disabled');

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <ImageIcon data-icon="inline-start" />
                    {t('view.official_backgrounds.settings.header')}
                </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col">
                <Field
                    label={t('view.official_backgrounds.settings.enabled')}
                    description={t(
                        'view.official_backgrounds.settings.description'
                    )}
                >
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Switch
                            checked={enabled}
                            disabled={loading}
                            onCheckedChange={(checked) => {
                                if (checked) {
                                    enableBackground();
                                    return;
                                }
                                disableBackground();
                            }}
                        />
                        <span className="text-sm">{statusLabel}</span>
                    </div>
                </Field>
                <Field
                    label={t('view.official_backgrounds.settings.provider')}
                    description={
                        providerId === 'nasa-apod-safe'
                            ? t('view.official_backgrounds.settings.apod_note')
                            : undefined
                    }
                >
                    <Select
                        value={providerId}
                        disabled={loading}
                        onValueChange={(value) =>
                            updateProvider(value as OfficialBackgroundProviderId)
                        }
                    >
                        <SelectTrigger size="sm" className="min-w-52">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {officialImageProviders.map((provider) => (
                                <SelectItem key={provider.id} value={provider.id}>
                                    {provider.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </Field>
                <Field
                    label={t('view.official_backgrounds.settings.current_image')}
                >
                    {snapshot ? (
                        <div className="text-sm">
                            <div className="font-medium">{snapshot.title}</div>
                            <div className="text-muted-foreground text-xs">
                                {snapshot.author} · {snapshot.license} ·{' '}
                                {snapshot.source}
                            </div>
                        </div>
                    ) : (
                        <span className="text-muted-foreground text-sm">
                            {t('view.official_backgrounds.settings.no_image')}
                        </span>
                    )}
                </Field>
                <div className="flex flex-wrap gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!enabled || loading}
                        onClick={refreshBackground}
                    >
                        <RefreshCwIcon data-icon="inline-start" />
                        {t('view.official_backgrounds.action.refresh')}
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
