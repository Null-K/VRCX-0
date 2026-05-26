export type OfficialBackgroundProviderId =
    | 'nasa-epic'
    | 'aic-public-domain'
    | 'nasa-apod-safe';

export interface OfficialBackgroundCredit {
    title: string;
    author: string;
    license: string;
    source: string;
}

export interface OfficialBackgroundSnapshot extends OfficialBackgroundCredit {
    providerId: OfficialBackgroundProviderId;
    imageUrl: string;
    resolvedAt: string;
    resolvedForDate: string;
}

export interface OfficialBackgroundProvider {
    id: OfficialBackgroundProviderId;
    name: string;
    priority: number;
    enabledByDefault: boolean;
    cacheTtlHours: number;
    resolveSnapshot(): Promise<OfficialBackgroundSnapshot>;
}
