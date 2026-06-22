import { describe, expect, it } from 'vitest';

import {
    createRequestError,
    isVrchatMissingCredentialsError,
    isVrchatSessionRecoveryError,
    unwrapErrorMessage
} from './vrchatRequest';

describe('vrchat request error classification', () => {
    it('classifies 401 and explicit missing credentials messages as missing credentials', () => {
        expect(
            isVrchatMissingCredentialsError(
                createRequestError('Unauthorized', 401, 'auth/user')
            )
        ).toBe(true);
        expect(
            isVrchatMissingCredentialsError(
                new Error('Missing Credentials for VRChat request')
            )
        ).toBe(true);
        expect(
            isVrchatMissingCredentialsError(
                createRequestError('Forbidden', 403, 'users/usr_1')
            )
        ).toBe(false);
        expect(isVrchatMissingCredentialsError(null)).toBe(false);
    });

    it('classifies only auth bootstrap 403 endpoints as session recovery errors', () => {
        expect(
            isVrchatSessionRecoveryError(
                createRequestError('Forbidden', 403, '/auth/user?apiKey=test')
            )
        ).toBe(true);
        expect(
            isVrchatSessionRecoveryError(
                createRequestError('Forbidden', 403, '/config')
            )
        ).toBe(true);
        expect(
            isVrchatSessionRecoveryError(
                createRequestError('Forbidden', 403, 'users/usr_1')
            )
        ).toBe(false);
        expect(
            isVrchatSessionRecoveryError(
                createRequestError('Unauthorized', 401, 'users/usr_1')
            )
        ).toBe(true);
    });

    it('unwraps nested and string error messages before using the status fallback', () => {
        expect(
            unwrapErrorMessage(
                { error: { message: '"Two factor required"' } },
                401
            )
        ).toBe('Two factor required');
        expect(unwrapErrorMessage('"plain failure"', 400)).toBe(
            'plain failure'
        );
        expect(unwrapErrorMessage({}, 500)).toBe('VRChat request failed (500)');
    });
});
