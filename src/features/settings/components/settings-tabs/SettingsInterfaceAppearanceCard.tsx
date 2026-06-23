import { ChevronDownIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { getLanguageName, languageCodes } from '@/localization/index';
import {
    APP_CJK_FONT_PACK_DEFAULT_KEY,
    APP_CJK_FONT_PACKS,
    APP_FONT_DEFAULT_KEY,
    APP_FONT_FAMILIES
} from '@/services/themeService';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
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

import { Field, SegmentedPreference, SettingsGroup } from '../SettingsField';

const fontFamilyLabelKeys: any = {
    inter: 'view.settings.appearance.appearance.font_family_inter',
    noto_sans: 'view.settings.appearance.appearance.font_family_noto_sans',
    geist: 'view.settings.appearance.appearance.font_family_geist',
    nunito_sans: 'view.settings.appearance.appearance.font_family_nunito_sans',
    ibm_plex_sans:
        'view.settings.appearance.appearance.font_family_ibm_plex_sans',
    jetbrains_mono:
        'view.settings.appearance.appearance.font_family_jetbrains_mono',
    fantasque_sans_mono:
        'view.settings.appearance.appearance.font_family_fantasque_sans_mono',
    system_ui: 'view.settings.appearance.appearance.font_family_system_ui',
    custom: 'view.settings.appearance.appearance.font_family_custom'
};

const cjkFontPackLabelKeys: any = {
    noto: 'view.settings.appearance.appearance.cjk_font_pack_noto',
    puhuiti: 'view.settings.appearance.appearance.cjk_font_pack_puhuiti',
    system: 'view.settings.appearance.appearance.font_family_system_ui'
};

const westernFontDropdownOptions = APP_FONT_FAMILIES.map((value: any) => [
    value,
    fontFamilyLabelKeys[value]
]).filter(([value]: any) => value !== 'custom' && value !== 'system_ui');

const cjkFontPackOptions = APP_CJK_FONT_PACKS.map((value: any) => [
    value,
    cjkFontPackLabelKeys[value]
]);

function getFontDropdownDisplayText(t: any, prefs: any) {
    if (prefs.appFontFamily === 'custom') {
        return t('view.settings.appearance.appearance.font_family_custom');
    }

    const fontLabel =
        fontFamilyLabelKeys[prefs.appFontFamily] ||
        fontFamilyLabelKeys[APP_FONT_DEFAULT_KEY];
    const cjkLabel =
        cjkFontPackLabelKeys[prefs.appCjkFontPack] ||
        cjkFontPackLabelKeys[APP_CJK_FONT_PACK_DEFAULT_KEY];
    return `${t(fontLabel)} / ${t(cjkLabel)}`;
}

function FontFamilyPreferenceField({
    t,
    prefs,
    onFontFamilyChange,
    onCjkFontPackChange
}: any) {
    return (
        <Field label={t('view.settings.appearance.appearance.font_family')}>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-w-44 justify-between font-normal"
                    >
                        <span className="truncate">
                            {getFontDropdownDisplayText(t, prefs)}
                        </span>
                        <ChevronDownIcon
                            data-icon="inline-end"
                            className="opacity-50"
                        />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuGroup>
                        <DropdownMenuRadioGroup
                            value={prefs.appFontFamily}
                            onValueChange={onFontFamilyChange}
                        >
                            {westernFontDropdownOptions.map(
                                ([value, labelKey]: any) => (
                                    <DropdownMenuRadioItem
                                        key={value}
                                        value={value}
                                    >
                                        {t(labelKey)}
                                    </DropdownMenuRadioItem>
                                )
                            )}
                            <DropdownMenuRadioItem value="custom">
                                {t(
                                    'view.settings.appearance.appearance.font_family_custom'
                                )}
                            </DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                        <DropdownMenuRadioGroup
                            value={
                                prefs.appFontFamily === 'custom'
                                    ? ''
                                    : prefs.appCjkFontPack
                            }
                            onValueChange={onCjkFontPackChange}
                        >
                            {cjkFontPackOptions.map(
                                ([value, labelKey]: any) => (
                                    <DropdownMenuRadioItem
                                        key={value}
                                        value={value}
                                    >
                                        {t(labelKey)}
                                    </DropdownMenuRadioItem>
                                )
                            )}
                        </DropdownMenuRadioGroup>
                    </DropdownMenuGroup>
                </DropdownMenuContent>
            </DropdownMenu>
        </Field>
    );
}

export function SettingsInterfaceAppearanceCard({
    locale,
    prefs,
    zoomInput,
    hideFontControls,
    onLanguageChange,
    onFontFamilyChange,
    onCjkFontPackChange,
    onZoomInputChange,
    onZoomBlur,
    onTableDensityChange,
    onDataTableStripedChange,
    onAccessibleStatusIndicatorsChange
}: any) {
    const { t } = useTranslation();

    return (
        <SettingsGroup title={t('view.settings.appearance.appearance.header')}>
            <Field
                label={t('view.settings.appearance.appearance.language')}
                controlId="settings-language"
            >
                <Select value={locale || 'en'} onValueChange={onLanguageChange}>
                    <SelectTrigger id="settings-language" className="w-56">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            {languageCodes.map((code: any) => (
                                <SelectItem key={code} value={code}>
                                    {getLanguageName(code)}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </Field>

            {!hideFontControls ? (
                <FontFamilyPreferenceField
                    t={t}
                    prefs={prefs}
                    onFontFamilyChange={onFontFamilyChange}
                    onCjkFontPackChange={onCjkFontPackChange}
                />
            ) : null}

            <Field
                label={t('view.settings.appearance.appearance.zoom')}
                controlId="settings-zoom"
            >
                <div className="flex items-center gap-2">
                    <Input
                        id="settings-zoom"
                        name="zoom"
                        inputMode="numeric"
                        type="number"
                        min={30}
                        max={300}
                        step={1}
                        className="w-28"
                        value={zoomInput}
                        onChange={(event: any) =>
                            onZoomInputChange(event.target.value)
                        }
                        onBlur={onZoomBlur}
                    />
                </div>
            </Field>

            <Field
                label={t('view.settings.appearance.appearance.table_density')}
            >
                <SegmentedPreference
                    value={prefs.tableDensity || 'standard'}
                    onChange={onTableDensityChange}
                    options={[
                        {
                            value: 'standard',
                            label: t(
                                'view.settings.appearance.appearance.table_density_standard'
                            )
                        },
                        {
                            value: 'compact',
                            label: t(
                                'view.settings.appearance.appearance.table_density_compact'
                            )
                        }
                    ]}
                />
            </Field>

            <Field
                label={t(
                    'view.settings.appearance.appearance.striped_data_table_mode'
                )}
            >
                <Switch
                    checked={prefs.dataTableStriped}
                    onCheckedChange={onDataTableStripedChange}
                />
            </Field>

            <Field
                label={t(
                    'view.settings.appearance.appearance.accessible_status_indicators'
                )}
                description={t(
                    'view.settings.appearance.appearance.accessible_status_indicators_description'
                )}
            >
                <Switch
                    checked={prefs.accessibleStatusIndicators}
                    onCheckedChange={onAccessibleStatusIndicatorsChange}
                />
            </Field>
        </SettingsGroup>
    );
}
