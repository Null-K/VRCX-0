import type {
    OfficialBackgroundProvider,
    OfficialBackgroundProviderId,
    OfficialBackgroundSnapshot
} from './officialBackgroundProviderTypes';

const NASA_EPIC_METADATA_URL = 'https://epic.gsfc.nasa.gov/api/natural';
const AIC_PUBLIC_DOMAIN_SEARCH_URL =
    'https://api.artic.edu/api/v1/artworks/search?query[term][is_public_domain]=true&fields=id,title,artist_display,image_id,is_public_domain&limit=100';
const AIC_DEFAULT_IIIF_URL = 'https://www.artic.edu/iiif/2';
const NASA_APOD_API_URL = 'https://api.nasa.gov/planetary/apod';
const NASA_APOD_API_KEY = 'DEMO_KEY';
const NASA_APOD_IMAGE_LOOKBACK_DAYS = 30;

interface NasaEpicEntry {
    image?: string;
    date?: string;
    caption?: string;
}

interface AicArtworkEntry {
    title?: string | null;
    artist_display?: string | null;
    image_id?: string | null;
    is_public_domain?: boolean;
}

interface AicSearchResponse {
    data?: AicArtworkEntry[];
    config?: {
        iiif_url?: string;
    };
}

interface NasaApodResponse {
    date?: string;
    title?: string;
    url?: string;
    hdurl?: string;
    media_type?: string;
    copyright?: string;
}

class OfficialBackgroundRateLimitError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'OfficialBackgroundRateLimitError';
    }
}

function currentDateKey(): string {
    return new Date().toISOString().slice(0, 10);
}

function addUtcDays(date: Date, offsetDays: number): Date {
    const nextDate = new Date(date);
    nextDate.setUTCDate(nextDate.getUTCDate() + offsetDays);
    return nextDate;
}

function formatUtcDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function stableDailyIndex(length: number): number {
    const date = currentDateKey();
    const seed = [...date].reduce(
        (value, char) => value + char.charCodeAt(0),
        0
    );
    return Math.abs(seed) % Math.max(1, length);
}

async function fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url, { cache: 'no-cache' });
    if (response.status === 429) {
        throw new OfficialBackgroundRateLimitError(
            'Daily Background provider rate limit reached.'
        );
    }
    if (!response.ok) {
        throw new Error(
            `Failed to load Daily Background provider: ${response.status} ${response.statusText}`
        );
    }
    return (await response.json()) as T;
}

function buildSnapshot({
    providerId,
    imageUrl,
    title,
    author,
    license,
    source
}: {
    providerId: OfficialBackgroundProviderId;
    imageUrl: string;
    title: string;
    author: string;
    license: string;
    source: string;
}): OfficialBackgroundSnapshot {
    return {
        providerId,
        imageUrl,
        title,
        author,
        license,
        source,
        resolvedAt: new Date().toISOString(),
        resolvedForDate: currentDateKey()
    };
}

function normalizeHttpsUrl(rawUrl: string, allowedHosts?: Set<string>): string {
    const parsedUrl = new URL(rawUrl);
    if (
        parsedUrl.protocol === 'http:' &&
        parsedUrl.hostname.endsWith('nasa.gov')
    ) {
        parsedUrl.protocol = 'https:';
    }
    if (parsedUrl.protocol !== 'https:') {
        throw new Error('Daily Background image must use HTTPS.');
    }
    if (allowedHosts && !allowedHosts.has(parsedUrl.hostname)) {
        throw new Error('Daily Background image host is not allowed.');
    }
    return parsedUrl.toString();
}

async function resolveNasaEpicSnapshot(): Promise<OfficialBackgroundSnapshot> {
    const entries = await fetchJson<NasaEpicEntry[]>(NASA_EPIC_METADATA_URL);
    const entry = [...(Array.isArray(entries) ? entries : [])]
        .filter((item) => item.image && item.date)
        .sort((left, right) =>
            String(right.date || '').localeCompare(String(left.date || ''))
        )[0];
    if (!entry?.image || !entry.date) {
        throw new Error('NASA EPIC did not return image metadata.');
    }

    const [date] = entry.date.split(' ');
    const [yyyy, mm, dd] = date.split('-');
    const imageUrl = normalizeHttpsUrl(
        `https://epic.gsfc.nasa.gov/archive/natural/${yyyy}/${mm}/${dd}/jpg/${entry.image}.jpg`
    );

    return buildSnapshot({
        providerId: 'nasa-epic',
        imageUrl,
        title: entry.caption || 'Earth from DSCOVR EPIC',
        author: 'NASA EPIC / DSCOVR',
        license: 'NASA media usage guidelines',
        source: 'NASA EPIC'
    });
}

async function resolveAicSnapshot(): Promise<OfficialBackgroundSnapshot> {
    const payload = await fetchJson<AicSearchResponse>(
        AIC_PUBLIC_DOMAIN_SEARCH_URL
    );
    const artworks = (payload.data || []).filter(
        (item) => item.is_public_domain === true && item.image_id
    );
    if (!artworks.length) {
        throw new Error('AIC did not return public-domain image metadata.');
    }

    const artwork = artworks[stableDailyIndex(artworks.length)];
    const iiifBase = String(payload.config?.iiif_url || AIC_DEFAULT_IIIF_URL);
    const imageUrl = normalizeHttpsUrl(
        `${iiifBase}/${artwork.image_id}/full/1686,/0/default.jpg`
    );

    return buildSnapshot({
        providerId: 'aic-public-domain',
        imageUrl,
        title: String(artwork.title || 'Public domain artwork'),
        author: String(artwork.artist_display || 'Art Institute of Chicago'),
        license: 'Public Domain',
        source: 'Art Institute of Chicago'
    });
}

function normalizeApodImage(
    value: NasaApodResponse,
    resolvedForDate: string
): OfficialBackgroundSnapshot | null {
    if (value.media_type !== 'image' || String(value.copyright || '').trim()) {
        return null;
    }

    const rawImageUrl = String(value.hdurl || value.url || '').trim();
    if (!rawImageUrl) {
        return null;
    }

    const allowedHosts = new Set([
        'apod.nasa.gov',
        'www.nasa.gov',
        'images-assets.nasa.gov'
    ]);
    let imageUrl: string;
    try {
        imageUrl = normalizeHttpsUrl(rawImageUrl, allowedHosts);
    } catch {
        return null;
    }

    return {
        providerId: 'nasa-apod-safe',
        imageUrl,
        title: String(value.title || 'NASA Astronomy Picture of the Day'),
        author: 'NASA APOD',
        license: 'Public Domain / no copyright field',
        source: String(value.date || resolvedForDate),
        resolvedAt: new Date().toISOString(),
        resolvedForDate
    };
}

async function fetchApodByDate(date: string): Promise<NasaApodResponse | null> {
    const url = new URL(NASA_APOD_API_URL);
    url.searchParams.set('api_key', NASA_APOD_API_KEY);
    url.searchParams.set('thumbs', 'false');
    url.searchParams.set('date', date);

    const response = await fetch(url.toString(), { cache: 'no-cache' });
    if (response.status === 404) {
        return null;
    }
    if (response.status === 429) {
        throw new OfficialBackgroundRateLimitError(
            'NASA APOD rate limit reached.'
        );
    }
    if (!response.ok) {
        throw new Error(
            `Failed to load NASA APOD: ${response.status} ${response.statusText}`
        );
    }

    return (await response.json()) as NasaApodResponse;
}

async function resolveNasaApodSnapshot(): Promise<OfficialBackgroundSnapshot> {
    const resolvedForDate = currentDateKey();
    const today = new Date();
    for (let offset = 0; offset <= NASA_APOD_IMAGE_LOOKBACK_DAYS; offset += 1) {
        const date = formatUtcDate(addUtcDays(today, -offset));
        const entry = await fetchApodByDate(date);
        if (!entry) {
            continue;
        }

        const snapshot = normalizeApodImage(entry, resolvedForDate);
        if (snapshot) {
            return snapshot;
        }
    }

    throw new Error(
        'NASA APOD did not return a copyright-free image in the recent archive.'
    );
}

export const officialImageProviders: OfficialBackgroundProvider[] = [
    {
        id: 'nasa-epic',
        name: 'NASA EPIC',
        priority: 1,
        enabledByDefault: true,
        cacheTtlHours: 24,
        resolveSnapshot: resolveNasaEpicSnapshot
    },
    {
        id: 'aic-public-domain',
        name: 'Art Institute of Chicago',
        priority: 2,
        enabledByDefault: false,
        cacheTtlHours: 24,
        resolveSnapshot: resolveAicSnapshot
    },
    {
        id: 'nasa-apod-safe',
        name: 'NASA APOD',
        priority: 3,
        enabledByDefault: false,
        cacheTtlHours: 24,
        resolveSnapshot: resolveNasaApodSnapshot
    }
].sort((left, right) => left.priority - right.priority);

export function resolveOfficialBackgroundProvider(
    value: unknown
): OfficialBackgroundProvider {
    const providerId = String(value || '').trim();
    return (
        officialImageProviders.find((provider) => provider.id === providerId) ||
        officialImageProviders[0]
    );
}
