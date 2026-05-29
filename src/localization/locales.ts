// Separate file, to be importable in `vite.config.ts`.
export const DEFAULT_LANGUAGE_CODE = 'en';

export const languageCodes = [
    'cs',
    'en',
    'es',
    'fr',
    'hu',
    'ja',
    'ko',
    'pl',
    'pt',
    'ru',
    'th',
    'vi',
    'zh-CN',
    'zh-TW'
];

export function normalizeLanguageCode(language: unknown) {
    const candidate = typeof language === 'string' ? language.trim() : '';
    return languageCodes.includes(candidate) ? candidate : DEFAULT_LANGUAGE_CODE;
}
