import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { KeyboardShortcut } from '@/components/keyboard/KeyboardShortcut';
import { OpenSourceNoticeDialog } from '@/features/settings/components/OpenSourceNoticeDialog';
import { openExternalLink } from '@/services/entityMediaService';
import { cn } from '@/lib/utils';
import { logoutFromReactShell } from '@/services/authExecutionService';
import {
    setSidebarCollapsedPreference,
    setTableDensityPreference,
    setThemeColorPreference,
    setThemeModePreference,
    setZoomLevelPreference
} from '@/services/preferencesService';
import { exitApplication } from '@/services/shellIntegrationService';
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
    getToolsByCategory,
    toolCategories
} from '@/shared/constants/tools';
import { publishNavCustomizeRequested } from '@/shared/events/navLayoutEvents';
import { formatReleaseDisplayVersion } from '@/shared/utils/releaseVersion';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useShellStore } from '@/state/shellStore';
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

function ThemeColorRadioItem({ themeColor }: any) {
    const { t } = useTranslation();

    return (
        <MenuRadioItem value={themeColor.key}>
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
    const zoomLevel = useShellStore((state: any) => state.zoomLevel);
    const sidebarOpen = useShellStore((state: any) => state.sidebarOpen);
    const themeMode = useShellStore((state: any) => state.themeMode);
    const themeColor = useShellStore((state: any) => state.themeColor);
    const tableDensity = useShellStore((state: any) => state.tableDensity);
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
                                            setThemeModePreference(value);
                                        }}
                                    >
                                        {themeModeOptions.map((mode: any) => (
                                            <MenuRadioItem
                                                key={mode}
                                                value={mode}
                                            >
                                                {themeModeLabel(mode, t)}
                                            </MenuRadioItem>
                                        ))}
                                    </MenubarRadioGroup>
                                    <MenubarSeparator />
                                    <MenubarRadioGroup
                                        value={themeColor}
                                        onValueChange={(value: any) => {
                                            setThemeColorPreference(value);
                                        }}
                                    >
                                        {THEME_COLORS.map((color: any) => (
                                            <ThemeColorRadioItem
                                                key={color.key}
                                                themeColor={color}
                                            />
                                        ))}
                                    </MenubarRadioGroup>
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
                    <MenubarContent align="start">
                        <MenubarGroup>
                            <MenuItem onSelect={() => navigate('/tools')}>
                                {t('app_menu.all_tools')}
                            </MenuItem>
                        </MenubarGroup>
                        {availableToolCategories.map((category: any) => (
                            <Fragment key={category.key}>
                                <MenubarSeparator />
                                <MenubarGroup>
                                    <MenubarLabel className="text-muted-foreground px-2 py-1.5 text-[11px] font-medium uppercase">
                                        {t(category.labelKey)}
                                    </MenubarLabel>
                                    {category.tools.map((tool: any) => (
                                        <ToolMenuItem
                                            key={tool.key}
                                            tool={tool}
                                        />
                                    ))}
                                </MenubarGroup>
                            </Fragment>
                        ))}
                    </MenubarContent>
                </MenubarMenu>

                <MenubarMenu>
                    <MenubarTrigger className="h-full rounded-none px-2 !py-0 text-xs">
                        {t('app_menu.help')}
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
