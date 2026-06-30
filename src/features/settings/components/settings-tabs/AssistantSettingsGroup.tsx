import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
    commands,
    type AssistantConfigStatus,
    type PlaybookMode
} from '@/platform/tauri/bindings';
import { recordAssistantApiKeyConfigured } from '@/services/telemetry/telemetryAssistantUsage';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Switch } from '@/ui/shadcn/switch';

import { Field, SettingsGroup } from '../SettingsField';

export function AssistantSettingsGroup() {
    const { t } = useTranslation();
    const [status, setStatus] = useState<AssistantConfigStatus | null>(null);
    const [baseUrl, setBaseUrl] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [model, setModel] = useState('');
    const [busy, setBusy] = useState(false);
    const [models, setModels] = useState<string[]>([]);
    const [detecting, setDetecting] = useState(false);
    const [allowWrites, setAllowWrites] = useState(false);
    const [playbookMode, setPlaybookMode] = useState<PlaybookMode>('auto');

    useEffect(() => {
        let active = true;
        commands
            .appAssistantConfigStatus()
            .then((next) => {
                if (!active) {
                    return;
                }
                setStatus(next);
                setBaseUrl(next.baseUrl);
                setModel(next.model);
                setAllowWrites(next.allowWrites);
                setPlaybookMode(next.playbookMode);
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, []);

    const detectModels = async () => {
        setDetecting(true);
        try {
            const next = await commands.appAssistantListModels(
                baseUrl,
                apiKey.trim() ? apiKey : null
            );
            setModels(next);
            if (next.length && !model.trim()) {
                setModel(next[0]);
            }
            if (next.length) {
                toast.success(t('assistant.settings.detect_success'));
            } else {
                toast.error(t('assistant.settings.detect_failed'));
            }
        } catch (error) {
            console.error('[assistant] detect models failed', error);
            toast.error(t('assistant.settings.detect_failed'));
        } finally {
            setDetecting(false);
        }
    };

    const save = async () => {
        setBusy(true);
        try {
            const hasNewApiKey = Boolean(apiKey.trim());
            const next = await commands.appAssistantSetConfig(
                baseUrl,
                hasNewApiKey ? apiKey : null,
                model,
                allowWrites,
                playbookMode
            );
            if (hasNewApiKey) {
                recordAssistantApiKeyConfigured();
            }
            setStatus(next);
            setApiKey('');
            toast.success(t('assistant.settings.saved'));
        } catch (error) {
            toast.error(String(error));
        } finally {
            setBusy(false);
        }
    };

    const privacyNotice = status?.isLocal
        ? t('assistant.settings.privacy_local')
        : t('assistant.settings.privacy_remote');

    return (
        <SettingsGroup
            title={t('assistant.settings.title')}
            description={t('assistant.settings.description')}
        >
            <Field label={t('assistant.settings.base_url')}>
                <Input
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                    placeholder={t('assistant.settings.base_url_placeholder')}
                />
            </Field>
            <Field
                label={t('assistant.settings.api_key')}
                description={
                    status?.configured
                        ? t('assistant.settings.api_key_set')
                        : undefined
                }
            >
                <Input
                    type="password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder={t('assistant.settings.api_key_placeholder')}
                />
            </Field>
            <Field label={t('assistant.settings.model')}>
                <div className="flex w-full max-w-md flex-col gap-2 sm:flex-row">
                    <Button
                        type="button"
                        variant="outline"
                        className="shrink-0"
                        disabled={detecting}
                        onClick={detectModels}
                    >
                        {detecting
                            ? t('assistant.settings.detecting')
                            : t('assistant.settings.detect')}
                    </Button>
                    {models.length ? (
                        <Select value={model} onValueChange={setModel}>
                            <SelectTrigger className="min-w-0 flex-1">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    {models.map((option) => (
                                        <SelectItem key={option} value={option}>
                                            {option}
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    ) : (
                        <Input
                            value={model}
                            onChange={(event) => setModel(event.target.value)}
                            placeholder={t(
                                'assistant.settings.model_placeholder'
                            )}
                        />
                    )}
                </div>
            </Field>
            <Field
                label={t('assistant.settings.allow_writes')}
                description={t('assistant.settings.allow_writes_description')}
            >
                <Switch
                    checked={allowWrites}
                    onCheckedChange={setAllowWrites}
                />
            </Field>
            <Field
                label={t('assistant.settings.playbook_mode')}
                description={t('assistant.settings.playbook_mode_description')}
            >
                <Select
                    value={playbookMode}
                    onValueChange={(value) =>
                        setPlaybookMode(value as PlaybookMode)
                    }
                >
                    <SelectTrigger className="w-full max-w-md">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            <SelectItem value="auto">
                                {t('assistant.settings.playbook_mode_auto')}
                            </SelectItem>
                            <SelectItem value="guided">
                                {t('assistant.settings.playbook_mode_guided')}
                            </SelectItem>
                            <SelectItem value="open">
                                {t('assistant.settings.playbook_mode_open')}
                            </SelectItem>
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </Field>
            <Field
                label={t('assistant.settings.privacy_title')}
                description={privacyNotice}
            >
                <Button onClick={save} disabled={busy}>
                    {t('assistant.settings.save')}
                </Button>
            </Field>
        </SettingsGroup>
    );
}
