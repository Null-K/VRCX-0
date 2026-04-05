// @ts-nocheck
import configRepository from '../services/config.js';
import vrcxJsonStorage from '../services/jsonStorage.js';

/** @type {Map<string, {resolve: Function, reject: Function}>} */
const pendingRequests = new Map();
let requestId = 0;

/** @type {Map<string, Function[]>} */
const eventHandlers = new Map();

/**
 * Register a handler for C# push events
 * @param {string} name
 * @param {Function} handler
 */
export function onBackendEvent(name, handler) {
    if (!eventHandlers.has(name)) {
        eventHandlers.set(name, []);
    }
    eventHandlers.get(name).push(handler);
}

/**
 * Send a request to the C# backend and return a Promise for the result
 * @param {string} method - Service.Method format
 * @param {any[]} args
 * @returns {Promise<any>}
 */
function callBackend(method, args) {
    return new Promise((resolve, reject) => {
        const id = String(++requestId);
        pendingRequests.set(id, { resolve, reject });
        window.chrome.webview.postMessage({ id, method, args });
    });
}

/**
 * Create a Proxy that wraps service calls into PostMessage requests
 * @param {string} serviceName
 * @returns {any}
 */
function createServiceProxy(serviceName) {
    return new Proxy(
        {},
        {
            get(_, methodName) {
                if (typeof methodName !== 'string') return undefined;
                return (...args) =>
                    callBackend(`${serviceName}.${methodName}`, args);
            }
        }
    );
}

function initMessageListener() {
    window.chrome.webview.addEventListener('message', (event) => {
        const msg = event.data;
        if (!msg) return;

        // Response to a pending request
        if (msg.id && pendingRequests.has(msg.id)) {
            const { resolve, reject } = pendingRequests.get(msg.id);
            pendingRequests.delete(msg.id);
            if (msg.error) {
                reject(new Error(msg.error));
            } else {
                resolve(msg.result);
            }
            return;
        }

        // Push event from C#
        if (msg.type === 'event' && msg.name) {
            const handlers = eventHandlers.get(msg.name);
            if (handlers) {
                for (const handler of handlers) {
                    try {
                        handler(msg.data);
                    } catch (e) {
                        console.error(
                            `Error in event handler for ${msg.name}:`,
                            e
                        );
                    }
                }
            }
        }
    });
}

export async function initInteropApi() {
    initMessageListener();

    // Create service proxies and expose as globals (matching legacy interop behavior)
    window.AppApi = createServiceProxy('AppApi');
    window.WebApi = createServiceProxy('WebApi');
    window.VRCXStorage = createServiceProxy('VRCXStorage');
    window.SQLite = createServiceProxy('SQLite');
    window.LogWatcher = createServiceProxy('LogWatcher');
    window.Discord = createServiceProxy('Discord');
    window.AssetBundleManager = createServiceProxy('AssetBundleManager');

    await configRepository.init();
    new vrcxJsonStorage(VRCXStorage);

    AppApi.SetUserAgent();
}
