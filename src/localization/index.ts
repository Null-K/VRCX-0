import csMessages from './cs.json';
import enMessages from './en.json';
import esMessages from './es.json';
import frMessages from './fr.json';
import huMessages from './hu.json';
import jaMessages from './ja.json';
import koMessages from './ko.json';
import plMessages from './pl.json';
import ptMessages from './pt.json';
import ruMessages from './ru.json';
import thMessages from './th.json';
import viMessages from './vi.json';
import zhCnMessages from './zh-CN.json';
import zhTwMessages from './zh-TW.json';

const localizedStrings: any = {
    cs: csMessages,
    en: enMessages,
    es: esMessages,
    fr: frMessages,
    hu: huMessages,
    ja: jaMessages,
    ko: koMessages,
    pl: plMessages,
    pt: ptMessages,
    ru: ruMessages,
    th: thMessages,
    vi: viMessages,
    'zh-CN': zhCnMessages,
    'zh-TW': zhTwMessages
};

function getAllLocalizedStrings() {
    return { ...localizedStrings };
}

async function getLocalizedStrings(code: any) {
    return localizedStrings[code] || localizedStrings.en || {};
}

function getLanguageName(code: any) {
    return String(localizedStrings[code]?.language ?? code).replace(
        /\s+\([^)]+\)$/,
        ''
    );
}

function resolveSystemLanguage(systemLanguage: any, codes: any) {
    if (!systemLanguage) return null;

    if (codes.includes(systemLanguage)) {
        return systemLanguage;
    }

    const lang = systemLanguage.split('-')[0];

    if (lang === 'zh') {
        const parts = systemLanguage.split('-').slice(1);
        const hasHant = parts.includes('Hant');
        const hasHans = parts.includes('Hans');
        const traditionalRegions = ['TW', 'HK', 'MO'];
        const hasTraditionalRegion = parts.some((p: any) =>
            traditionalRegions.includes(p)
        );

        if (hasHant || hasTraditionalRegion) {
            return codes.includes('zh-TW') ? 'zh-TW' : null;
        }
        if (hasHans) {
            return codes.includes('zh-CN') ? 'zh-CN' : null;
        }
        return codes.includes('zh-CN') ? 'zh-CN' : null;
    }

    return codes.find((code: any) => code.split('-')[0] === lang) ?? null;
}

export * from './locales';
export {
    getAllLocalizedStrings,
    getLanguageName,
    getLocalizedStrings,
    resolveSystemLanguage
};
