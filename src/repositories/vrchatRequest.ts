import {
    getVrchatEndpointBase,
    normalizeVrchatEndpoint
} from '@/shared/vrchatEndpoint.js';

import { safeJsonParse } from './baseRepository.js';
import webRepository, { type WebExecuteOptions } from './webRepository.js';

const JSON_CONTENT_TYPE = 'application/json;charset=utf-8';

export type QueryValue = string | number | boolean | Date | null | undefined;
export type QueryParams = Record<string, QueryValue | QueryValue[]>;

export interface VrchatRequestOptions {
    endpoint?: string;
    method?: string;
    params?: QueryParams | null;
    headers?: Record<string, string>;
    allowDebugEndpoint?: boolean;
    normalizeEndpoint?: boolean;
    fallbackMessage?: string;
    decorateError?: boolean;
    includeParams?: boolean;
    returnEndpointDomain?: boolean;
    skipEmptyQueryString?: boolean;
    jsonBody?: boolean;
    body?: unknown;
    queryParams?: QueryParams | null;
    extra?: Record<string, unknown>;
}

export interface VrchatRequestResponse<TJson = unknown> {
    json: TJson;
    params?: QueryParams;
    status: number;
    endpointDomain?: string;
    raw: unknown;
    [key: string]: unknown;
}

export interface VrchatRequestError extends Error {
    status: number;
    endpoint: string;
    payload: unknown;
}

export type VrchatAuthFailureHandler = (
    error: VrchatRequestError
) => void | Promise<void>;

let vrchatAuthFailureHandler: VrchatAuthFailureHandler | null = null;
let vrchatAuthFailureHandlerRegistrationId = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

export function setVrchatAuthFailureHandler(
    handler: VrchatAuthFailureHandler | null
): () => void {
    const registrationId = ++vrchatAuthFailureHandlerRegistrationId;
    vrchatAuthFailureHandler = typeof handler === 'function' ? handler : null;

    return () => {
        if (vrchatAuthFailureHandlerRegistrationId === registrationId) {
            vrchatAuthFailureHandler = null;
        }
    };
}

export function isVrchatMissingCredentialsError(
    error: unknown
): error is VrchatRequestError {
    return Boolean(
        error &&
        typeof error === 'object' &&
        (error as Partial<VrchatRequestError>).status === 401 &&
        typeof (error as Error).message === 'string' &&
        (error as Error).message.includes('Missing Credentials')
    );
}

function notifyVrchatAuthFailure(error: VrchatRequestError): void {
    if (!isVrchatMissingCredentialsError(error) || !vrchatAuthFailureHandler) {
        return;
    }

    try {
        void Promise.resolve(vrchatAuthFailureHandler(error)).catch(
            (handlerError) => {
                console.warn(
                    'VRChat auth failure handler failed:',
                    handlerError
                );
            }
        );
    } catch (handlerError) {
        console.warn('VRChat auth failure handler failed:', handlerError);
    }
}

function shouldSkipQueryValue(
    value: unknown,
    { skipEmptyString = false }: { skipEmptyString?: boolean } = {}
): boolean {
    return (
        value === null ||
        value === undefined ||
        (skipEmptyString && value === '')
    );
}

function serializeQueryValue(value: QueryValue): string {
    return value instanceof Date ? value.toISOString() : String(value);
}

export function appendParams(
    url: URL,
    params: QueryParams = {},
    options: { skipEmptyString?: boolean } = {}
): URL {
    if (!params || typeof params !== 'object') {
        return url;
    }

    for (const [key, value] of Object.entries(params)) {
        if (shouldSkipQueryValue(value, options)) {
            continue;
        }

        if (Array.isArray(value)) {
            for (const item of value) {
                if (shouldSkipQueryValue(item, options)) {
                    continue;
                }
                url.searchParams.append(key, serializeQueryValue(item));
            }
            continue;
        }

        url.searchParams.set(key, serializeQueryValue(value));
    }

    return url;
}

export function buildUrl(
    path: string,
    params: QueryParams = {},
    endpoint = '',
    options: { allowDebugEndpoint?: boolean; skipEmptyString?: boolean } = {}
): string {
    const url = new URL(
        path,
        getVrchatEndpointBase(endpoint, {
            allowDebugEndpoint: Boolean(options.allowDebugEndpoint)
        })
    );
    return appendParams(url, params, options).toString();
}

export function parseJsonResponse(data: unknown): unknown {
    if (data === null || data === undefined || data === '') {
        return data ?? null;
    }

    if (typeof data !== 'string') {
        return data;
    }

    return safeJsonParse(data, data);
}

export function unwrapErrorMessage(
    json: unknown,
    status: number,
    { fallbackMessage = 'VRChat request failed' } = {}
): string {
    if (typeof json === 'string' && json.trim()) {
        return json.replace(/^"+|"+$/g, '');
    }

    const jsonRecord = isRecord(json) ? json : null;
    const error = isRecord(jsonRecord?.error) ? jsonRecord.error : null;
    const message = error?.message ?? jsonRecord?.message;
    if (typeof message === 'string' && message.trim()) {
        return message.replace(/^"+|"+$/g, '');
    }

    return `${fallbackMessage} (${status})`;
}

export function createRequestError(
    message: string,
    status: number,
    endpoint: string,
    payload: unknown = null
): VrchatRequestError {
    const error = new Error(message) as VrchatRequestError;
    error.status = status;
    error.endpoint = endpoint;
    error.payload = payload;
    return error;
}

function normalizeJsonBody(value: unknown): Record<string, unknown> {
    return isRecord(value) ? value : {};
}

export async function executeVrchatRequest<TJson = unknown>(
    path: string,
    {
        endpoint = '',
        method = 'GET',
        params = null,
        headers = {},
        allowDebugEndpoint = false,
        normalizeEndpoint = false,
        fallbackMessage = 'VRChat request failed',
        decorateError = true,
        includeParams = false,
        returnEndpointDomain = false,
        skipEmptyQueryString = false,
        jsonBody = method !== 'GET',
        body = params,
        queryParams = null,
        extra = {}
    }: VrchatRequestOptions = {}
): Promise<VrchatRequestResponse<TJson>> {
    const requestMethod = String(method || 'GET').toUpperCase();
    const endpointDomain = normalizeEndpoint
        ? normalizeVrchatEndpoint(endpoint)
        : endpoint;
    const resolvedQueryParams =
        queryParams ?? (requestMethod === 'GET' ? (params ?? {}) : {});
    const requestOptions: WebExecuteOptions = {
        url: buildUrl(path, resolvedQueryParams, endpointDomain, {
            allowDebugEndpoint,
            skipEmptyString: skipEmptyQueryString
        }),
        method: requestMethod
    };

    if (headers && Object.keys(headers).length > 0) {
        requestOptions.headers = headers;
    }

    if (requestMethod !== 'GET' && jsonBody) {
        requestOptions.headers = {
            'Content-Type': JSON_CONTENT_TYPE,
            ...headers
        };
        requestOptions.body = JSON.stringify(normalizeJsonBody(body));
    }

    const response = await webRepository.execute(requestOptions);
    const json = parseJsonResponse(response.data);

    if (response.status >= 400 || (isRecord(json) && 'error' in json)) {
        const message = unwrapErrorMessage(json, response.status, {
            fallbackMessage
        });
        const requestError = createRequestError(
            message,
            response.status,
            path,
            json
        );
        notifyVrchatAuthFailure(requestError);
        if (decorateError) {
            throw requestError;
        }
        throw new Error(message);
    }

    return {
        json: json as TJson,
        ...(includeParams ? { params: params ?? {} } : {}),
        ...extra,
        status: response.status,
        ...(returnEndpointDomain ? { endpointDomain } : {}),
        raw: response.raw
    };
}
