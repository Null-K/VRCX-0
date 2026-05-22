import { normalizeProfileLanguageRows } from '@/shared/utils/userLanguage';

export function resolveUserLanguages(user: any) {
    return normalizeProfileLanguageRows(user);
}
