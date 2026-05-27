export type CommunityThemeAccentMode = boolean;
export type CommunityThemeDarkMode = boolean;

export interface CommunityThemeAuthor {
    name: string;
    github: string;
    url?: string;
}

export interface CommunityThemeManifest {
    id: string;
    name: string;
    version: string;
    author: CommunityThemeAuthor;
    description: string;
    tags: string[];
    testedWith: string;
    remoteAssets: boolean;
    darkMode: CommunityThemeDarkMode;
    accentMode: CommunityThemeAccentMode;
    previewUrl: string;
    readmeUrl: string;
}

export interface CommunityThemeCatalog {
    sourceUrl: string;
    schemaVersion: number;
    themes: CommunityThemeManifest[];
}

export interface CommunityThemeInstallMetadata {
    themeId: string;
    themeName: string;
    version: string;
    sourceUrl: string;
    sha256: string;
    installedAt: string;
    updatedAt: string;
    darkMode: CommunityThemeDarkMode;
    accentMode: CommunityThemeAccentMode;
}

export interface CommunityThemeLocalPreview {
    folderPath: string;
    cssPath: string;
    manifestPath?: string | null;
    themeName: string;
    version: string;
    darkMode: CommunityThemeDarkMode;
    accentMode: CommunityThemeAccentMode;
    cssLength: number;
    loadedAt: string;
}
