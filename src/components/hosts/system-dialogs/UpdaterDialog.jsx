import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { openExternalLink } from '@/lib/entityMedia.js';
import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import { backend } from '@/platform/index.js';
import {
    canInstallUpdatesOnPlatform,
    defaultBranchForVersion,
    downloadAndInstallUpdate,
    fetchBranchReleases,
    formatReleaseDisplayVersion,
    sanitizeBranch
} from '@/services/updateService.js';
import { links } from '@/shared/constants/link.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { FieldGroup } from '@/ui/shadcn/field';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Tabs, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

export function UpdaterDialog({ open, onOpenChange }) {
    const { t } = useTranslation();
    const hostPlatform = useRuntimeStore(
        (state) => state.hostCapabilities.platform
    );
    const canInstallUpdates = canInstallUpdatesOnPlatform(hostPlatform);

    const [branch, setBranch] = useState(() =>
        defaultBranchForVersion(VERSION || '')
    );
    const [releases, setReleases] = useState([]);
    const [releaseVersion, setReleaseVersion] = useState('');
    const [loading, setLoading] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [detail, setDetail] = useState('');
    const selectedRelease =
        releases.find(
            (release) => release.canonicalVersion === releaseVersion
        ) || null;

    useEffect(() => {
        if (!open) {
            return undefined;
        }

        let active = true;
        setLoading(true);
        setDetail('Checking update state.');

        fetchBranchReleases(branch, {
            hostPlatform,
            requireInstallerAsset: canInstallUpdates
        })
            .then((nextReleases) => {
                if (!active) {
                    return;
                }

                setReleases(nextReleases);
                setReleaseVersion((current) =>
                    nextReleases.some(
                        (release) => release.canonicalVersion === current
                    )
                        ? current
                        : nextReleases[0]?.canonicalVersion || ''
                );
                setDetail(
                    nextReleases.length
                        ? ''
                        : canInstallUpdates
                          ? 'No downloadable releases found.'
                          : 'No releases found.'
                );
            })
            .catch((error) => {
                if (active) {
                    setDetail(
                        userFacingErrorMessage(
                            error,
                            'Failed to load update releases.'
                        )
                    );
                }
            })
            .finally(() => {
                if (active) {
                    setLoading(false);
                }
            });

        return () => {
            active = false;
        };
    }, [branch, canInstallUpdates, hostPlatform, open]);

    async function handleInstallUpdate() {
        if (!canInstallUpdates || !selectedRelease || downloading) {
            return;
        }

        setDownloading(true);
        setProgress(0);
        setDetail(
            t('host.system_dialogs.generated_dynamic.downloading_value', {
                value: selectedRelease.displayName
            })
        );
        try {
            await downloadAndInstallUpdate(selectedRelease, {
                branch,
                hostPlatform,
                onProgress: setProgress
            });
            await backend.app.RestartApplication();
        } catch (error) {
            setDetail(
                userFacingErrorMessage(error, 'Failed to install update.')
            );
        } finally {
            setDownloading(false);
            setProgress(0);
        }
    }

    async function handleOpenReleasePage() {
        await openExternalLink(selectedRelease?.htmlUrl || links.releases);
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        {t('dialog.system.generated.vrcx_0_update')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('dialog.system.generated.current_version')}{' '}
                        {formatReleaseDisplayVersion(VERSION || '') || '-'}.
                    </DialogDescription>
                </DialogHeader>
                <FieldGroup>
                    <Tabs
                        value={branch}
                        onValueChange={(value) =>
                            setBranch(sanitizeBranch(value))
                        }
                    >
                        <TabsList className="grid w-full grid-cols-3">
                            <TabsTrigger value="Stable">
                                {t('dialog.vrcx_updater.branch_stable')}
                            </TabsTrigger>
                            <TabsTrigger value="Beta">
                                {t('dialog.vrcx_updater.branch_beta')}
                            </TabsTrigger>
                            <TabsTrigger value="Alpha">
                                {t('dialog.vrcx_updater.branch_alpha')}
                            </TabsTrigger>
                        </TabsList>
                    </Tabs>
                    {canInstallUpdates ? (
                        <div className="border-input bg-background text-foreground flex h-9 w-full items-center truncate rounded-md border px-3 text-sm">
                            {selectedRelease?.displayName ||
                                (loading
                                    ? 'Loading releases'
                                    : 'Select release')}
                        </div>
                    ) : (
                        <Select
                            value={releaseVersion}
                            onValueChange={setReleaseVersion}
                            disabled={loading || downloading}
                        >
                            <SelectTrigger>
                                <SelectValue
                                    placeholder={
                                        loading
                                            ? 'Loading releases'
                                            : 'Select release'
                                    }
                                />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    {releases.map((release) => (
                                        <SelectItem
                                            key={release.canonicalVersion}
                                            value={release.canonicalVersion}
                                        >
                                            {release.displayName}
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    )}
                    {canInstallUpdates && downloading ? (
                        <div className="flex flex-col gap-2">
                            <div className="bg-muted h-2 overflow-hidden rounded-full">
                                <div
                                    className="bg-primary h-full transition-[width]"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                            <div className="text-muted-foreground text-xs">
                                {progress === 100
                                    ? 'Installing update.'
                                    : `${progress}%`}
                            </div>
                        </div>
                    ) : null}
                    {detail ? (
                        <div className="text-muted-foreground text-sm">
                            {userFacingErrorMessage(
                                detail,
                                'Failed to update VRCX-0.'
                            )}
                        </div>
                    ) : null}
                </FieldGroup>
                <DialogFooter>
                    {canInstallUpdates ? (
                        <Button
                            type="button"
                            disabled={
                                !selectedRelease || loading || downloading
                            }
                            onClick={() => void handleInstallUpdate()}
                        >
                            {t('dialog.system.generated.install_and_restart')}
                        </Button>
                    ) : (
                        <Button
                            type="button"
                            disabled={loading}
                            onClick={() => void handleOpenReleasePage()}
                        >
                            {t('nav_menu.update')}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
