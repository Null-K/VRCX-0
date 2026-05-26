import { SettingsTabContent } from '../SettingsViewParts';
import { SettingsInterfaceAppearanceCard } from './SettingsInterfaceAppearanceCard';
import { SettingsInterfaceCommunityThemesCard } from './SettingsInterfaceCommunityThemesCard';
import { SettingsInterfaceDisplayCards } from './SettingsInterfaceDisplayCards';
import { SettingsInterfaceOfficialBackgroundsCard } from './SettingsInterfaceOfficialBackgroundsCard';
import { SettingsInterfaceUserColorsCard } from './SettingsInterfaceUserColorsCard';

export function SettingsInterfaceTab({ settingsInterface }: any) {
    const {
        locale,
        prefs,
        zoomInput,
        zoomLevel,
        onLanguageChange,
        onFontFamilyChange,
        onCjkFontPackChange,
        onZoomInputChange,
        onZoomBlur,
        onDataTableStripedChange,
        onAccessibleStatusIndicatorsChange,
        onShowInstanceIdInLocationChange,
        onAgeGatedInstancesVisibleChange,
        onHideNicknamesChange,
        onDisplayVrcPlusIconsAsAvatarChange,
        onShowNewDashboardButtonChange,
        onOpenTablePageSizes,
        onOpenTableLimits,
        onHour12Change,
        onIsoFormatChange,
        onWeekStartsOnChange,
        onFeedTimeDisplayModeChange,
        onHideUserNotesChange,
        onHideUserMemosChange,
        onHideUnfriendsChange,
        onRandomUserColoursChange,
        onResetTrustColors,
        onSaveTrustColor,
        onTrustColorDraftChange
    } = settingsInterface;
    return (
        <SettingsTabContent value="interface">
            <SettingsInterfaceAppearanceCard
                locale={locale}
                prefs={prefs}
                zoomInput={zoomInput}
                zoomLevel={zoomLevel}
                onLanguageChange={onLanguageChange}
                onFontFamilyChange={onFontFamilyChange}
                onCjkFontPackChange={onCjkFontPackChange}
                onZoomInputChange={onZoomInputChange}
                onZoomBlur={onZoomBlur}
                onDataTableStripedChange={onDataTableStripedChange}
                onAccessibleStatusIndicatorsChange={
                    onAccessibleStatusIndicatorsChange
                }
            />
            <SettingsInterfaceOfficialBackgroundsCard />
            <SettingsInterfaceCommunityThemesCard />
            <SettingsInterfaceDisplayCards
                prefs={prefs}
                onShowInstanceIdInLocationChange={
                    onShowInstanceIdInLocationChange
                }
                onAgeGatedInstancesVisibleChange={
                    onAgeGatedInstancesVisibleChange
                }
                onHideNicknamesChange={onHideNicknamesChange}
                onDisplayVrcPlusIconsAsAvatarChange={
                    onDisplayVrcPlusIconsAsAvatarChange
                }
                onShowNewDashboardButtonChange={onShowNewDashboardButtonChange}
                onOpenTablePageSizes={onOpenTablePageSizes}
                onOpenTableLimits={onOpenTableLimits}
                onHour12Change={onHour12Change}
                onIsoFormatChange={onIsoFormatChange}
                onWeekStartsOnChange={onWeekStartsOnChange}
                onFeedTimeDisplayModeChange={onFeedTimeDisplayModeChange}
                onHideUserNotesChange={onHideUserNotesChange}
                onHideUserMemosChange={onHideUserMemosChange}
                onHideUnfriendsChange={onHideUnfriendsChange}
            />
            <SettingsInterfaceUserColorsCard
                prefs={prefs}
                onRandomUserColoursChange={onRandomUserColoursChange}
                onResetTrustColors={onResetTrustColors}
                onSaveTrustColor={onSaveTrustColor}
                onTrustColorDraftChange={onTrustColorDraftChange}
            />
        </SettingsTabContent>
    );
}
