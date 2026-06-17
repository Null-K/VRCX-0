import { commands } from '@/platform/tauri/bindings';
import { useRuntimeStore } from '@/state/runtimeStore';

import { stopRuntimeUpdateLoopAndWaitForIdle } from './updateLoopService';

function currentAuthScope() {
    const auth = useRuntimeStore.getState().auth;
    return {
        userId: String(
            auth.currentUserId ?? auth.currentUserSnapshot?.id ?? ''
        ).trim(),
        endpoint: auth.currentUserEndpoint ?? ''
    };
}

export async function startBackgroundModeForCurrentSession() {
    const { userId, endpoint } = currentAuthScope();
    await stopRuntimeUpdateLoopAndWaitForIdle();
    await commands.appRuntimeAuthScopeSet({ userId, endpoint });
    return commands.appStartBackgroundMode();
}
