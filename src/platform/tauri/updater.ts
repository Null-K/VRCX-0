import { Channel } from '@tauri-apps/api/core';

import { commands } from './bindings';
import type { TauriDownloadEvent, TauriUpdateMetadata } from './bindings';

export type TauriUpdateRequest = {
    manifestUrl: string;
    target: string;
    allowDowngrades: boolean;
    proxy?: string | null;
};

type TauriUpdateEventHandler = (event: TauriDownloadEvent) => void;

export async function checkTauriUpdate(
    request: TauriUpdateRequest
): Promise<TauriUpdateMetadata | null> {
    return commands.appCheckTauriUpdate(
        request.manifestUrl,
        request.target,
        request.allowDowngrades,
        request.proxy ?? null
    );
}

export async function downloadAndInstallTauriUpdate(
    request: TauriUpdateRequest,
    onEvent: TauriUpdateEventHandler
): Promise<TauriUpdateMetadata | null> {
    return commands.appDownloadAndInstallTauriUpdate(
        request.manifestUrl,
        request.target,
        request.allowDowngrades,
        request.proxy ?? null,
        new Channel<TauriDownloadEvent>(onEvent)
    );
}
