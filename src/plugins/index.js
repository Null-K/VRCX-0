import { initDayjs } from './dayjs';
import { initInteropApi } from './interopApi';
import { initUi } from './ui';

/**
 * @returns {Promise<void>}
 */
export async function initPlugins() {
    await initInteropApi();
    await initUi();
    initDayjs();
}

export * from './i18n';
export * from './components';
export * from './router';
