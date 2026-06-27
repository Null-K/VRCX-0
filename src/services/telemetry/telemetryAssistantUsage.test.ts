import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
});

function mockDeps(options: { anonymous: boolean }) {
    const postTelemetry = vi.fn((_path: string, _payload: unknown) =>
        Promise.resolve()
    );

    vi.doMock('./telemetryConfig', () => ({
        isAnonymousUsageTelemetryEnabled: () => options.anonymous
    }));
    vi.doMock('./telemetryClient', () => ({ postTelemetry }));
    vi.doMock('./telemetryPayload', () => ({
        buildTelemetryContext: () => ({ installId: 'i', sessionId: 's' })
    }));

    return { postTelemetry };
}

const session = { installId: 'i', sessionId: 's' };

type AssistantUsagePayload = {
    opens: number;
    apiKeyConfigured?: boolean;
};

describe('assistant usage telemetry', () => {
    it('reports cumulative opens and API key configuration without raw config values', async () => {
        const { postTelemetry } = mockDeps({ anonymous: true });
        const mod = await import('./telemetryAssistantUsage');

        mod.recordAssistantOpen();
        mod.recordAssistantOpen();
        mod.recordAssistantApiKeyConfigured();
        await mod.sendAssistantUsage(session);

        const [path, payload] = postTelemetry.mock.calls[0] as [
            string,
            AssistantUsagePayload
        ];
        expect(path).toBe('/api/v1/telemetry/assistant-usage');
        expect(payload).toMatchObject({
            opens: 2,
            apiKeyConfigured: true
        });
        expect(JSON.stringify(payload)).not.toContain('sk-');
        expect(JSON.stringify(payload)).not.toContain('baseUrl');
        expect(JSON.stringify(payload)).not.toContain('model');
    });

    it('does not send when there is no usage to report', async () => {
        const { postTelemetry } = mockDeps({ anonymous: true });
        const mod = await import('./telemetryAssistantUsage');

        await mod.sendAssistantUsage(session);

        expect(postTelemetry).not.toHaveBeenCalled();
    });

    it('does not send when anonymous usage telemetry is off', async () => {
        const { postTelemetry } = mockDeps({ anonymous: false });
        const mod = await import('./telemetryAssistantUsage');

        mod.recordAssistantOpen();
        mod.recordAssistantApiKeyConfigured();
        await mod.sendAssistantUsage(session);

        expect(postTelemetry).not.toHaveBeenCalled();
    });

    it('resets accumulated usage after flush', async () => {
        const { postTelemetry } = mockDeps({ anonymous: true });
        const mod = await import('./telemetryAssistantUsage');

        mod.recordAssistantOpen();
        mod.recordAssistantApiKeyConfigured();
        await mod.sendAssistantUsage(session);
        mod.resetAssistantUsage();
        await mod.sendAssistantUsage(session);

        expect(postTelemetry).toHaveBeenCalledTimes(1);
    });
});
