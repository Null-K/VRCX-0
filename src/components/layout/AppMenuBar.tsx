import { CheckIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { KeyboardShortcut } from '@/components/keyboard/KeyboardShortcut';
import { OpenSourceNoticeDialog } from '@/features/settings/components/OpenSourceNoticeDialog';
import { cn } from '@/lib/utils';
import { tauriClient } from '@/platform/tauri/client';
import configRepository from '@/repositories/configRepository';
import { logoutFromReactShell } from '@/services/authExecutionService';
import { startBackgroundModeForCurrentSession } from '@/services/backgroundModeService';
import {
    disableInstalledCommunityTheme,
    enableInstalledCommunityTheme,
    stopLocalCommunityThemePreview
} from '@/services/communityThemeService';
import { openExternalLink } from '@/services/entityMediaService';
import {
    disableOfficialBackground,
    enableOfficialBackground,
    officialImageProviders
} from '@/services/officialBackgroundService';
import {
    setSidebarCollapsedPreference,
    setTableDensityPreference,
    setThemeColorPreference,
    setThemeModePreference,
    setZoomLevelPreference
} from '@/services/preferencesService';
import {
    exitApplication,
    restartApplication
} from '@/services/shellIntegrationService';
import {
    formatZoomPercentage,
    normalizeZoomLevel
} from '@/services/themeService';
import {
    isToolCapabilityAvailable,
    triggerToolByKey
} from '@/services/toolActionService';
import { links } from '@/shared/constants/link';
import { THEME_COLORS } from '@/shared/constants/themes';
import {
    TOOLS_QUICK_ACCESS_UPDATED_EVENT,
    getToolsByCategory,
    parseQuickAccessToolKeys,
    quickAccessConfigKey,
    toolCategories
} from '@/shared/constants/tools';
import { publishNavCustomizeRequested } from '@/shared/events/navLayoutEvents';
import { formatReleaseDisplayVersion } from '@/shared/utils/releaseVersion';
import {
    getBuildBadgeI18nKey,
    isThemeDeveloperBuild
} from '@/shared/buildLabel';
import {
    communityThemeControlsAccent,
    communityThemeControlsAppearance,
    useCommunityThemeStore
} from '@/state/communityThemeStore';
import { useOfficialBackgroundStore } from '@/state/officialBackgroundStore';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useShellStore } from '@/state/shellStore';
import { Badge } from '@/ui/shadcn/badge';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import {
    Menubar,
    MenubarContent,
    MenubarGroup,
    MenubarItem,
    MenubarLabel,
    MenubarMenu,
    MenubarRadioGroup,
    MenubarRadioItem,
    MenubarSeparator,
    MenubarShortcut,
    MenubarSub,
    MenubarSubContent,
    MenubarSubTrigger,
    MenubarTrigger
} from '@/ui/shadcn/menubar';

const ZOOM_STEP = 10;
const themeModeOptions = ['system', 'light', 'dark'];
const tableDensityOptions = [
    {
        value: 'standard',
        labelKey: 'view.settings.appearance.appearance.table_density_standard'
    },
    {
        value: 'compact',
        labelKey: 'view.settings.appearance.appearance.table_density_compact'
    }
];

function themeModeLabel(themeMode: any, t: any) {
    return t(`view.settings.appearance.appearance.theme_mode_${themeMode}`);
}

function themeColorLabel(themeColor: any, t: any) {
    return t(`view.settings.appearance.theme_color.${themeColor.key}`);
}

function MenuItem({ children, onSelect, ...props }: any) {
    return (
        <MenubarItem
            className="min-h-7 min-w-48 text-xs"
            onSelect={onSelect}
            {...props}
        >
            {children}
        </MenubarItem>
    );
}

function MenuRadioItem({ children, className, ...props }: any) {
    return (
        <MenubarRadioItem
            className={cn(
                'min-h-7 min-w-48 !pr-7 !pl-1.5 text-xs [&>span:first-child]:!right-1.5 [&>span:first-child]:!left-auto',
                className
            )}
            {...props}
        >
            {children}
        </MenubarRadioItem>
    );
}

function ThemeColorRadioItem({ themeColor, disabled = false }: any) {
    const { t } = useTranslation();

    return (
        <MenuRadioItem value={themeColor.key} disabled={disabled}>
            <span className="flex min-w-0 items-center gap-2">
                <span
                    aria-hidden="true"
                    className="border-foreground/10 size-2.5 shrink-0 rounded-full border"
                    style={{ backgroundColor: themeColor.swatch }}
                />
                <span className="truncate">
                    {themeColorLabel(themeColor, t)}
                </span>
            </span>
        </MenuRadioItem>
    );
}

function ToolMenuItem({ tool }: any) {
    const { t } = useTranslation();
    const navigate = useNavigate();

    return (
        <MenuItem
            onSelect={() => {
                triggerToolByKey(tool.key, { navigate, t });
            }}
        >
            {t(tool.titleKey)}
        </MenuItem>
    );
}

export function AppMenuBar({
    rightSidebarOpen,
    onOpenQuickSearch,
    onOpenDirectAccess,
    onOpenNotificationCenter,
    onToggleRightSidebar
}: any) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [aboutOpen, setAboutOpen] = useState(false);
    const [openSourceNoticeOpen, setOpenSourceNoticeOpen] = useState(false);
    const [quickAccessKeys, setQuickAccessKeys] = useState<any[]>([]);
    const zoomLevel = useShellStore((state: any) => state.zoomLevel);
    const sidebarOpen = useShellStore((state: any) => state.sidebarOpen);
    const themeMode = useShellStore((state: any) => state.themeMode);
    const themeColor = useShellStore((state: any) => state.themeColor);
    const tableDensity = useShellStore((state: any) => state.tableDensity);
    const communityThemeEnabled = useCommunityThemeStore(
        (state: any) => state.enabled
    );
    const installedCommunityTheme = useCommunityThemeStore(
        (state: any) => state.installedTheme
    );
    const installedCommunityThemes = useCommunityThemeStore(
        (state: any) => state.installedThemes
    );
    const localCommunityThemePreview = useCommunityThemeStore(
        (state: any) => state.localPreview
    );
    const officialBackgroundEnabled = useOfficialBackgroundStore(
        (state: any) => state.enabled
    );
    const officialBackgroundProviderId = useOfficialBackgroundStore(
        (state: any) => state.providerId
    );
    const notificationLayout = usePreferencesStore(
        (state: any) => state.notificationLayout
    );
    const setSystemHostOpen = useRuntimeStore(
        (state: any) => state.setSystemHostOpen
    );
    const hostPlatform = useRuntimeStore(
        (state: any) => state.hostCapabilities.platform
    );
    const hostCapabilities = useRuntimeStore(
        (state: any) => state.hostCapabilities
    );
    const currentZoom = normalizeZoomLevel(zoomLevel);
    const quickSearchShortcutKeys =
        hostPlatform === 'macos' ? ['Meta', 'K'] : ['Ctrl', 'K'];
    const directAccessShortcutKeys =
        hostPlatform === 'macos' ? ['Meta', 'D'] : ['Ctrl', 'D'];
    // oxlint-disable-next-line no-undef
    const appVersion = formatReleaseDisplayVersion(VERSION || '') || '-';
    const buildBadgeKey = getBuildBadgeI18nKey();
    const developerToolsAvailable = isThemeDeveloperBuild();
    const availableToolCategories = useMemo(
        () =>
            toolCategories
                .map((category: any) => ({
                    ...category,
                    tools: getToolsByCategory(category.key).filter(
                        (tool: any) => isToolCapabilityAvailable(tool)
                    )
                }))
                .filter((category: any) => category.tools.length > 0),
        [hostCapabilities]
    );
    const availableToolMap = useMemo(
        () =>
            new Map(
                availableToolCategories
                    .flatMap((category: any) => category.tools)
                    .map((tool: any) => [tool.key, tool])
            ),
        [availableToolCategories]
    );
    const quickAccessTools = useMemo(
        () =>
            quickAccessKeys
                .map((key: any) => availableToolMap.get(key))
                .filter(Boolean),
        [availableToolMap, quickAccessKeys]
    );
    const communityThemeAccentControlled = communityThemeControlsAccent(
        communityThemeEnabled,
        installedCommunityTheme,
        localCommunityThemePreview
    );
    const communityThemeAppearanceControlled = communityThemeControlsAppearance(
        communityThemeEnabled,
        installedCommunityTheme,
        localCommunityThemePreview
    );
    const customThemeAppearanceControlled =
        communityThemeAppearanceControlled || officialBackgroundEnabled;

    useEffect(() => {
        let active = true;
        const loadQuickAccessTools = () => {
            configRepository
                .getString(quickAccessConfigKey, '[]')
                .then((value: any) => {
                    if (active) {
                        setQuickAccessKeys(parseQuickAccessToolKeys(value));
                    }
                })
                .catch(() => {
                    if (active) {
                        setQuickAccessKeys([]);
                    }
                });
        };

        loadQuickAccessTools();
        window.addEventListener(
            TOOLS_QUICK_ACCESS_UPDATED_EVENT,
            loadQuickAccessTools
        );
        return () => {
            active = false;
            window.removeEventListener(
                TOOLS_QUICK_ACCESS_UPDATED_EVENT,
                loadQuickAccessTools
            );
        };
    }, []);

    async function applyZoomLevel(nextZoom: any) {
        try {
            await setZoomLevelPreference(nextZoom);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('app_menu.messages.zoom_failed')
            );
        }
    }

    async function runLogout() {
        try {
            await logoutFromReactShell();
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('app_menu.messages.logout_failed')
            );
        }
    }

    async function runRestartApplication() {
        try {
            await restartApplication();
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('app_menu.messages.restart_failed')
            );
        }
    }

    async function runStartBackgroundMode() {
        try {
            await startBackgroundModeForCurrentSession();
        } catch {
            toast.error(
                t('component.app_status_bar.toast.failed_to_start_background_mode')
            );
        }
    }

    async function runOpenDevtools() {
        try {
            await tauriClient.app.OpenDevtools();
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('app_menu.messages.open_devtools_failed')
            );
        }
    }

    async function runEnableInstalledCommunityTheme(themeId?: string) {
        if (
            !themeId ||
            (communityThemeEnabled && installedCommunityTheme?.themeId === themeId)
        ) {
            return;
        }

        try {
            await enableInstalledCommunityTheme(themeId);
            toast.success(t('view.community_themes.toast.theme_enabled'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.community_themes.toast.theme_failed')
            );
        }
    }

    async function runDisableInstalledCommunityTheme() {
        if (!communityThemeEnabled) {
            return;
        }

        try {
            await disableInstalledCommunityTheme();
            toast.success(t('view.community_themes.toast.theme_disabled'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.community_themes.toast.disable_failed')
            );
        }
    }

    async function runEnableOfficialBackground(providerId: string) {
        try {
            const enabledBackground = await enableOfficialBackground(providerId);
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

    async function runDisableOfficialBackground() {
        if (!officialBackgroundEnabled) {
            return;
        }

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

    function openLink(url: any) {
        openExternalLink(url);
    }

    function openNotificationSurface() {
        if (notificationLayout === 'table') {
            navigate('/notification');
            return;
        }
        onOpenNotificationCenter?.();
    }

    return (
        <>
            <Menubar className="h-full border-0 bg-transparent !p-0 shadow-none">
                <MenubarMenu>
                    <MenubarTrigger className="h-full rounded-none px-2 !py-0 text-xs">
                        {t('app_menu.app')}
                    </MenubarTrigger>
                    <MenubarContent align="start">
                        <MenubarGroup>
                            <MenuItem onSelect={() => navigate('/settings')}>
                                {t('app_menu.settings')}
                            </MenuItem>
                            <MenuItem
                                onSelect={() =>
                                    setSystemHostOpen('updaterOpen', true)
                                }
                            >
                                {t('app_menu.check_updates')}
                            </MenuItem>
                            <MenuItem
                                onSelect={() => {
                                    runRestartApplication();
                                }}
                            >
                                {t('app_menu.restart')}
                            </MenuItem>
                            <MenuItem
                                onSelect={() => {
                                    runStartBackgroundMode();
                                }}
                            >
                                {t('app_menu.start_background_mode')}
                            </MenuItem>
                        </MenubarGroup>
                        <MenubarSeparator />
                        <MenubarGroup>
                            <MenuItem
                                variant="destructive"
                                onSelect={() => {
                                    runLogout();
                                }}
                            >
                                {t('app_menu.logout')}
                            </MenuItem>
                            <MenuItem
                                variant="destructive"
                                onSelect={() => {
                                    exitApplication();
                                }}
                            >
                                {t('app_menu.quit')}
                            </MenuItem>
                        </MenubarGroup>
                    </MenubarContent>
                </MenubarMenu>

                <MenubarMenu>
                    <MenubarTrigger className="h-full rounded-none px-2 !py-0 text-xs">
                        {t('app_menu.view')}
                    </MenubarTrigger>
                    <MenubarContent align="start">
                        <MenubarGroup>
                            <MenuItem onSelect={() => onOpenQuickSearch?.()}>
                                {t('app_menu.quick_search')}
                                <MenubarShortcut className="tracking-normal">
                                    <KeyboardShortcut
                                        keys={quickSearchShortcutKeys}
                                        className="gap-0.5"
                                        kbdClassName="h-4 min-w-4 px-1 text-[10px] leading-4"
                                    />
                                </MenubarShortcut>
                            </MenuItem>
                            <MenuItem onSelect={() => onOpenDirectAccess?.()}>
                                {t('prompt.direct_access_omni.header')}
                                <MenubarShortcut className="tracking-normal">
                                    <KeyboardShortcut
                                        keys={directAccessShortcutKeys}
                                        className="gap-0.5"
                                        kbdClassName="h-4 min-w-4 px-1 text-[10px] leading-4"
                                    />
                                </MenubarShortcut>
                            </MenuItem>
                            <MenuItem
                                onSelect={() => openNotificationSurface()}
                            >
                                {t('app_menu.notification_center')}
                            </MenuItem>
                            <MenuItem
                                onSelect={() => {
                                    setSidebarCollapsedPreference(sidebarOpen);
                                }}
                            >
                                {t(
                                    sidebarOpen
                                        ? 'nav_tooltip.collapse_menu'
                                        : 'nav_tooltip.expand_menu'
                                )}
                            </MenuItem>
                            <MenuItem onSelect={() => onToggleRightSidebar?.()}>
                                {t(
                                    rightSidebarOpen
                                        ? 'app_menu.hide_side_panel'
                                        : 'app_menu.show_side_panel'
                                )}
                            </MenuItem>
                            <MenuItem
                                onSelect={() => publishNavCustomizeRequested()}
                            >
                                {t('nav_menu.custom_nav.header')}
                            </MenuItem>
                        </MenubarGroup>
                        <MenubarSeparator />
                        <MenubarGroup>
                            <MenubarSub>
                                <MenubarSubTrigger className="min-h-7 min-w-48 text-xs">
                                    {t(
                                        'view.settings.appearance.appearance.theme_mode'
                                    )}
                                </MenubarSubTrigger>
                                <MenubarSubContent className="w-56">
                                    <MenubarRadioGroup
                                        value={themeMode}
                                        onValueChange={(value: any) => {
                                            if (customThemeAppearanceControlled) {
                                                return;
                                            }
                                            setThemeModePreference(value);
                                        }}
                                    >
                                        {themeModeOptions.map((mode: any) => (
                                            <MenuRadioItem
                                                key={mode}
                                                value={mode}
                                                disabled={
                                                    customThemeAppearanceControlled
                                                }
                                            >
                                                {themeModeLabel(mode, t)}
                                            </MenuRadioItem>
                                        ))}
                                    </MenubarRadioGroup>
                                    <MenubarSeparator />
                                    {communityThemeAppearanceControlled ? (
                                        <MenubarLabel className="text-muted-foreground px-2 py-1.5 text-[11px] leading-snug whitespace-normal">
                                            {t(
                                                'view.community_themes.menu.appearance_disabled'
                                            )}
                                        </MenubarLabel>
                                    ) : null}
                                    {officialBackgroundEnabled ? (
                                        <MenubarLabel className="text-muted-foreground px-2 py-1.5 text-[11px] leading-snug whitespace-normal">
                                            {t(
                                                'view.official_backgrounds.menu.appearance_disabled'
                                            )}
                                        </MenubarLabel>
                                    ) : null}
                                    {communityThemeAccentControlled ? (
                                        <MenubarLabel className="text-muted-foreground px-2 py-1.5 text-[11px] leading-snug whitespace-normal">
                                            {t(
                                                'view.community_themes.menu.accent_disabled'
                                            )}
                                        </MenubarLabel>
                                    ) : null}
                                    <MenubarRadioGroup
                                        value={themeColor}
                                        onValueChange={(value: any) => {
                                            if (
                                                communityThemeAccentControlled
                                            ) {
                                                return;
                                            }
                                            setThemeColorPreference(value);
                                        }}
                                    >
                                        {THEME_COLORS.map((color: any) => (
                                            <ThemeColorRadioItem
                                                key={color.key}
                                                themeColor={color}
                                                disabled={
                                                    communityThemeAccentControlled
                                                }
                                            />
                                        ))}
                                    </MenubarRadioGroup>
                                </MenubarSubContent>
                            </MenubarSub>
                            <MenubarSub>
                                <MenubarSubTrigger className="min-h-7 min-w-48 text-xs">
                                    {t('view.community_themes.header')}
                                </MenubarSubTrigger>
                                <MenubarSubContent className="w-60">
                                    <MenuItem
                                        onSelect={() => {
                                            runDisableInstalledCommunityTheme();
                                        }}
                                    >
                                        <span className="flex min-w-0 items-center gap-2">
                                            <span className="inline-flex size-3.5 shrink-0 items-center justify-center">
                                                {!communityThemeEnabled ? (
                                                    <CheckIcon data-icon="inline-start" />
                                                ) : null}
                                            </span>
                                            <span className="min-w-0 truncate">
                                                {t(
                                                    'view.community_themes.action.no_theme'
                                                )}
                                            </span>
                                        </span>
                                    </MenuItem>
                                    <MenubarSeparator />
                                    {installedCommunityThemes?.length ? (
                                        installedCommunityThemes.map(
                                            (theme: any) => {
                                                const active =
                                                    communityThemeEnabled &&
                                                    installedCommunityTheme?.themeId ===
                                                        theme.themeId;
                                                return (
                                                    <MenuItem
                                                        key={theme.themeId}
                                                        onSelect={() => {
                                                            runEnableInstalledCommunityTheme(
                                                                theme.themeId
                                                            );
                                                        }}
                                                    >
                                                        <span className="flex min-w-0 items-center gap-2">
                                                            <span className="inline-flex size-3.5 shrink-0 items-center justify-center">
                                                                {active ? (
                                                                    <CheckIcon data-icon="inline-start" />
                                                                ) : null}
                                                            </span>
                                                            <span className="min-w-0 truncate">
                                                                {theme.themeName}
                                                            </span>
                                                        </span>
                                                    </MenuItem>
                                                );
                                            }
                                        )
                                    ) : (
                                        <MenubarLabel className="text-muted-foreground px-2 py-1.5 text-xs font-normal">
                                            {t(
                                                'view.community_themes.installed.empty'
                                            )}
                                        </MenubarLabel>
                                    )}
                                    <MenubarSeparator />
                                    <MenuItem
                                        onSelect={() =>
                                            navigate('/community-themes')
                                        }
                                    >
                                        {t('view.community_themes.header')}
                                    </MenuItem>
                                </MenubarSubContent>
                            </MenubarSub>
                            <MenubarSub>
                                <MenubarSubTrigger className="min-h-7 min-w-48 text-xs">
                                    {t('view.official_backgrounds.menu.header')}
                                </MenubarSubTrigger>
                                <MenubarSubContent className="w-60">
                                    <MenuItem
                                        onSelect={() => {
                                            runDisableOfficialBackground();
                                        }}
                                    >
                                        <span className="flex min-w-0 items-center gap-2">
                                            <span className="inline-flex size-3.5 shrink-0 items-center justify-center">
                                                {!officialBackgroundEnabled ? (
                                                    <CheckIcon data-icon="inline-start" />
                                                ) : null}
                                            </span>
                                            <span className="min-w-0 truncate">
                                                {t(
                                                    'view.official_backgrounds.action.off'
                                                )}
                                            </span>
                                        </span>
                                    </MenuItem>
                                    <MenubarSeparator />
                                    {officialImageProviders.map((provider) => {
                                        const active =
                                            officialBackgroundEnabled &&
                                            officialBackgroundProviderId ===
                                                provider.id;
                                        return (
                                            <MenuItem
                                                key={provider.id}
                                                onSelect={() => {
                                                    runEnableOfficialBackground(
                                                        provider.id
                                                    );
                                                }}
                                            >
                                                <span className="flex min-w-0 items-center gap-2">
                                                    <span className="inline-flex size-3.5 shrink-0 items-center justify-center">
                                                        {active ? (
                                                            <CheckIcon data-icon="inline-start" />
                                                        ) : null}
                                                    </span>
                                                    <span className="min-w-0 truncate">
                                                        {provider.name}
                                                    </span>
                                                </span>
                                            </MenuItem>
                                        );
                                    })}
                                </MenubarSubContent>
                            </MenubarSub>
                            <MenubarSub>
                                <MenubarSubTrigger className="min-h-7 min-w-48 text-xs">
                                    {t(
                                        'view.settings.appearance.appearance.table_density'
                                    )}
                                </MenubarSubTrigger>
                                <MenubarSubContent className="w-48">
                                    <MenubarRadioGroup
                                        value={tableDensity}
                                        onValueChange={(value: any) => {
                                            setTableDensityPreference(value);
                                        }}
                                    >
                                        {tableDensityOptions.map(
                                            (option: any) => (
                                                <MenuRadioItem
                                                    key={option.value}
                                                    value={option.value}
                                                >
                                                    {t(option.labelKey)}
                                                </MenuRadioItem>
                                            )
                                        )}
                                    </MenubarRadioGroup>
                                </MenubarSubContent>
                            </MenubarSub>
                        </MenubarGroup>
                        <MenubarSeparator />
                        <MenubarGroup>
                            <MenuItem
                                onSelect={() => {
                                    applyZoomLevel(currentZoom + ZOOM_STEP);
                                }}
                            >
                                {t('app_menu.zoom_in')}
                                <MenubarShortcut className="tracking-normal">
                                    {formatZoomPercentage(
                                        currentZoom + ZOOM_STEP
                                    )}
                                </MenubarShortcut>
                            </MenuItem>
                            <MenuItem
                                onSelect={() => {
                                    applyZoomLevel(currentZoom - ZOOM_STEP);
                                }}
                            >
                                {t('app_menu.zoom_out')}
                                <MenubarShortcut className="tracking-normal">
                                    {formatZoomPercentage(
                                        currentZoom - ZOOM_STEP
                                    )}
                                </MenubarShortcut>
                            </MenuItem>
                            <MenuItem
                                onSelect={() => {
                                    applyZoomLevel(100);
                                }}
                            >
                                {t('app_menu.reset_zoom')}
                                <MenubarShortcut className="tracking-normal">
                                    {formatZoomPercentage(100)}
                                </MenubarShortcut>
                            </MenuItem>
                        </MenubarGroup>
                    </MenubarContent>
                </MenubarMenu>

                <MenubarMenu>
                    <MenubarTrigger className="h-full rounded-none px-2 !py-0 text-xs">
                        {t('app_menu.tools')}
                    </MenubarTrigger>
                    <MenubarContent align="start" className="w-56">
                        <MenubarGroup>
                            <MenuItem onSelect={() => navigate('/tools')}>
                                {t('app_menu.all_tools')}
                            </MenuItem>
                        </MenubarGroup>
                        {quickAccessTools.length > 0 ? (
                            <>
                                <MenubarSeparator />
                                <MenubarGroup>
                                    <MenubarLabel className="text-muted-foreground px-2 py-1.5 text-[11px] font-medium uppercase">
                                        {t('view.tools.quick_access.header')}
                                    </MenubarLabel>
                                    {quickAccessTools.map((tool: any) => (
                                        <ToolMenuItem
                                            key={tool.key}
                                            tool={tool}
                                        />
                                    ))}
                                </MenubarGroup>
                            </>
                        ) : null}
                        {availableToolCategories.length > 0 ? (
                            <MenubarSeparator />
                        ) : null}
                        {availableToolCategories.map((category: any) => (
                            <MenubarSub key={category.key}>
                                <MenubarSubTrigger className="min-h-7 min-w-48 text-xs">
                                    {t(category.labelKey)}
                                </MenubarSubTrigger>
                                <MenubarSubContent className="w-56">
                                    {category.tools.map((tool: any) => (
                                        <ToolMenuItem
                                            key={tool.key}
                                            tool={tool}
                                        />
                                    ))}
                                </MenubarSubContent>
                            </MenubarSub>
                        ))}
                    </MenubarContent>
                </MenubarMenu>

                <MenubarMenu>
                    <MenubarTrigger className="h-full rounded-none px-2 !py-0 text-xs">
                        <span className="flex min-w-0 items-center gap-1.5">
                            <span>{t('app_menu.help')}</span>
                            {buildBadgeKey ? (
                                <Badge
                                    variant="secondary"
                                    className="h-4 rounded-md px-1 text-[10px] leading-none shadow-none"
                                >
                                    {t(buildBadgeKey)}
                                </Badge>
                            ) : null}
                        </span>
                    </MenubarTrigger>
                    <MenubarContent align="start">
                        <MenubarGroup>
                            <MenuItem onSelect={() => openLink(links.github)}>
                                {t('app_menu.github')}
                            </MenuItem>
                            <MenuItem onSelect={() => openLink(links.issues)}>
                                {t('app_menu.report_issue')}
                            </MenuItem>
                            <MenuItem onSelect={() => openLink(links.discord)}>
                                {t('nav_menu.discord')}
                            </MenuItem>
                            <MenuItem onSelect={() => openLink(links.qqGroup)}>
                                {t('nav_menu.qq_group')}
                            </MenuItem>
                            <MenuItem onSelect={() => openLink(links.releases)}>
                                {t('nav_menu.changelog')}
                            </MenuItem>
                        </MenubarGroup>
                        <MenubarSeparator />
                        {developerToolsAvailable ? (
                            <>
                                <MenubarGroup>
                                    <MenuItem onSelect={() => runOpenDevtools()}>
                                        {t('app_menu.open_devtools')}
                                    </MenuItem>
                                </MenubarGroup>
                                <MenubarSeparator />
                            </>
                        ) : null}
                        <MenubarGroup>
                            <MenuItem
                                onSelect={() => setOpenSourceNoticeOpen(true)}
                            >
                                {t('app_menu.open_source_licenses')}
                            </MenuItem>
                            <MenuItem onSelect={() => setAboutOpen(true)}>
                                {t('app_menu.about')}
                                <MenubarShortcut className="tracking-normal">
                                    {appVersion}
                                </MenubarShortcut>
                            </MenuItem>
                        </MenubarGroup>
                    </MenubarContent>
                </MenubarMenu>
            </Menubar>

            <OpenSourceNoticeDialog
                open={openSourceNoticeOpen}
                onOpenChange={setOpenSourceNoticeOpen}
            />

            <Dialog open={aboutOpen} onOpenChange={setAboutOpen}>
                <DialogContent showCloseButton={false}>
                    <DialogHeader>
                        <DialogTitle>{t('app_menu.about_title')}</DialogTitle>
                        <DialogDescription>
                            {t('app_menu.about_description')}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="bg-muted/30 rounded-lg border p-3 text-sm">
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">
                                {t('app_menu.version')}
                            </span>
                            <span className="font-medium">{appVersion}</span>
                        </div>
                    </div>
                    <DialogFooter showCloseButton />
                </DialogContent>
            </Dialog>
        </>
    );
}
