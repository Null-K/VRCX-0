import { toast } from 'sonner';

import { webRepository } from '@/repositories/index.js';
import {
    isVrchatMissingCredentialsError,
    setVrchatAuthFailureHandler
} from '@/repositories/vrchatRequest.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';

import {
    resetCurrentUserRuntimeAuth,
    setSignedOutSessionState
} from './authExecutionService.js';
import { refreshSavedAuthSnapshot } from './authSnapshotService.js';
import i18n from './i18nService.js';

let recoveryPromise = null;

function shouldHandleRuntimeAuthFailure(error) {
    if (!isVrchatMissingCredentialsError(error)) {
        return false;
    }

    const sessionState = useSessionStore.getState();
    const runtimeState = useRuntimeStore.getState();
    return Boolean(
        sessionState.sessionPhase === 'ready' &&
        sessionState.isLoggedIn &&
        runtimeState.auth.currentUserId
    );
}

async function runRuntimeAuthRecovery(error) {
    if (!shouldHandleRuntimeAuthFailure(error)) {
        return;
    }

    const runtimeStore = useRuntimeStore.getState();
    const [title, description] = await Promise.all([
        i18n.t('message.auth.session_expired'),
        i18n.t('message.auth.session_restore_available')
    ]);

    runtimeStore.setStartupTask('auth', 'running', title);
    toast.warning(title, {
        description
    });

    try {
        await webRepository.clearCookies();
    } catch (clearError) {
        console.warn(
            'Failed to clear cookies after VRChat session expired:',
            clearError
        );
    }

    setSignedOutSessionState();
    resetCurrentUserRuntimeAuth();

    try {
        await refreshSavedAuthSnapshot();
    } catch (snapshotError) {
        console.warn(
            'Failed to refresh saved auth snapshot after VRChat session expired:',
            snapshotError
        );
    }
}

function handleRuntimeAuthFailure(error) {
    if (!shouldHandleRuntimeAuthFailure(error)) {
        return;
    }

    if (!recoveryPromise) {
        recoveryPromise = runRuntimeAuthRecovery(error).finally(() => {
            recoveryPromise = null;
        });
    }

    return recoveryPromise;
}

export function startRuntimeAuthFailureRecovery() {
    const unsubscribe = setVrchatAuthFailureHandler(handleRuntimeAuthFailure);

    return () => {
        unsubscribe();
    };
}
