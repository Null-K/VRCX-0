export const VRCX_CSS_LAYER_ATTR = 'data-vrcx-0-css-layer';

export const VRCX_CSS_LAYERS = [
    'official-background',
    'installed-theme',
    'local-theme-preview',
    'user-override'
] as const;

export type VrcxCssLayer = (typeof VRCX_CSS_LAYERS)[number];

const layerSnapshots: Record<VrcxCssLayer, string> = {
    'official-background': '',
    'installed-theme': '',
    'local-theme-preview': '',
    'user-override': ''
};
const suppressedLayers = new Set<VrcxCssLayer>();

function isKnownLayer(value: string | null): value is VrcxCssLayer {
    return VRCX_CSS_LAYERS.includes(value as VrcxCssLayer);
}

function renderCssLayers(): void {
    if (typeof document === 'undefined') {
        return;
    }

    document
        .querySelectorAll(`style[${VRCX_CSS_LAYER_ATTR}]`)
        .forEach((styleElement: any) => {
            if (isKnownLayer(styleElement.getAttribute(VRCX_CSS_LAYER_ATTR))) {
                styleElement.remove();
            }
        });

    VRCX_CSS_LAYERS.forEach((layer) => {
        const cssText = layerSnapshots[layer];
        if (suppressedLayers.has(layer) || !cssText.trim()) {
            return;
        }

        const styleElement = document.createElement('style');
        styleElement.setAttribute(VRCX_CSS_LAYER_ATTR, layer);
        styleElement.textContent = cssText;
        document.head.appendChild(styleElement);
    });
}

export function setVrcxCssLayer(layer: VrcxCssLayer, cssText: string): void {
    layerSnapshots[layer] = String(cssText || '');
    renderCssLayers();
}

export function setVrcxCssLayers(
    layers: Partial<Record<VrcxCssLayer, string>>
): void {
    Object.entries(layers).forEach(([layer, cssText]) => {
        if (isKnownLayer(layer)) {
            layerSnapshots[layer] = String(cssText || '');
        }
    });
    renderCssLayers();
}

export function clearVrcxCssLayer(layer: VrcxCssLayer): void {
    setVrcxCssLayer(layer, '');
}

export function setVrcxCssLayersSuppressed(
    layers: VrcxCssLayer[],
    suppressed: boolean
): void {
    layers.forEach((layer) => {
        if (suppressed) {
            suppressedLayers.add(layer);
            return;
        }
        suppressedLayers.delete(layer);
    });
    renderCssLayers();
}
