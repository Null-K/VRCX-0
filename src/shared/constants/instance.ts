const instanceContentSettings = [
    'emoji',
    'stickers',
    'pedestals',
    'prints',
    'drones',
    'props'
] as const;

type InstanceContentSetting = (typeof instanceContentSettings)[number];

export { instanceContentSettings };
export type { InstanceContentSetting };
