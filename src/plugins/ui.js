import {
    applyAppCjkFontPack,
    applyAppFontFamily,
    changeAppThemeStyle,
    changeHtmlLangAttribute,
    getThemeMode,
    initThemeColor,
    refreshCustomCss
} from '../shared/utils/base/ui';
import {
    APP_CJK_FONT_PACK_DEFAULT_KEY,
    APP_FONT_DEFAULT_KEY
} from '../shared/constants';
import { i18n, loadLocalizedStrings } from './i18n';

import configRepository from '../services/config';

export async function initUi() {
    try {
        const language = await configRepository.getString(
            'VRCX-0_appLanguage',
            'en'
        );
        // @ts-ignore
        i18n.locale = language;
        await loadLocalizedStrings(language);
        changeHtmlLangAttribute(language);

        const { initThemeMode } = await getThemeMode(configRepository);
        changeAppThemeStyle(initThemeMode);
        await initThemeColor();
    } catch (error) {
        console.error('Error initializing locale and theme:', error);
    }

    refreshCustomCss();
}
