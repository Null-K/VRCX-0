import { defineStore } from 'pinia';
import { ref } from 'vue';

import { useSharedFeedStore } from '../sharedFeed';

import configRepository from '../../services/config';

export const useWristOverlaySettingsStore = defineStore(
    'WristOverlaySettings',
    () => {
        const sharedFeed = useSharedFeedStore();

        const overlayWrist = ref(true);
        const hidePrivateFromFeed = ref(false);
        const openVRAlways = ref(false);
        const overlaybutton = ref(false);
        const overlayHand = ref('0');
        const vrBackgroundEnabled = ref(false);
        const minimalFeed = ref(true);
        const hideDevicesFromFeed = ref(false);
        const vrOverlayCpuUsage = ref(false);
        const hideUptimeFromFeed = ref(false);
        const pcUptimeOnFeed = ref(false);

        async function initWristOverlaySettings() {
            const [
                overlayWristConfig,
                hidePrivateFromFeedConfig,
                openVRAlwaysConfig,
                overlaybuttonConfig,
                overlayHandConfig,
                vrBackgroundEnabledConfig,
                minimalFeedConfig,
                hideDevicesFromFeedConfig,
                vrOverlayCpuUsageConfig,
                hideUptimeFromFeedConfig,
                pcUptimeOnFeedConfig
            ] = await Promise.all([
                configRepository.getBool('VRCX-0_overlayWrist', false),
                configRepository.getBool('VRCX-0_hidePrivateFromFeed', false),
                configRepository.getBool('openVRAlways', false),
                configRepository.getBool('VRCX-0_overlaybutton', false),
                configRepository.getInt('VRCX-0_overlayHand', 0),
                configRepository.getBool('VRCX-0_vrBackgroundEnabled', false),
                configRepository.getBool('VRCX-0_minimalFeed', true),
                configRepository.getBool('VRCX-0_hideDevicesFromFeed', false),
                configRepository.getBool('VRCX-0_vrOverlayCpuUsage', false),
                configRepository.getBool('VRCX-0_hideUptimeFromFeed', false),
                configRepository.getBool('VRCX-0_pcUptimeOnFeed', false)
            ]);

            overlayWrist.value = overlayWristConfig;
            hidePrivateFromFeed.value = hidePrivateFromFeedConfig;
            openVRAlways.value = openVRAlwaysConfig;
            overlaybutton.value = overlaybuttonConfig;
            overlayHand.value = String(overlayHandConfig);
            vrBackgroundEnabled.value = vrBackgroundEnabledConfig;
            minimalFeed.value = minimalFeedConfig;
            hideDevicesFromFeed.value = hideDevicesFromFeedConfig;
            vrOverlayCpuUsage.value = vrOverlayCpuUsageConfig;
            hideUptimeFromFeed.value = hideUptimeFromFeedConfig;
            pcUptimeOnFeed.value = pcUptimeOnFeedConfig;
        }

        function setOverlayWrist() {
            overlayWrist.value = !overlayWrist.value;
            configRepository.setBool('VRCX-0_overlayWrist', overlayWrist.value);
        }
        function setHidePrivateFromFeed() {
            hidePrivateFromFeed.value = !hidePrivateFromFeed.value;
            configRepository.setBool(
                'VRCX-0_hidePrivateFromFeed',
                hidePrivateFromFeed.value
            );
            sharedFeed.loadSharedFeed();
        }
        function setOpenVRAlways() {
            openVRAlways.value = !openVRAlways.value;
            configRepository.setBool('openVRAlways', openVRAlways.value);
        }
        function setOverlaybutton() {
            overlaybutton.value = !overlaybutton.value;
            configRepository.setBool('VRCX-0_overlaybutton', overlaybutton.value);
        }
        /**
         * @param {string} value
         */
        function setOverlayHand(value) {
            overlayHand.value = value;
            let overlayHandInt = parseInt(value, 10);
            if (isNaN(overlayHandInt)) {
                overlayHandInt = 0;
            }
            configRepository.setInt('VRCX-0_overlayHand', overlayHandInt);
        }
        function setVrBackgroundEnabled() {
            vrBackgroundEnabled.value = !vrBackgroundEnabled.value;
            configRepository.setBool(
                'VRCX-0_vrBackgroundEnabled',
                vrBackgroundEnabled.value
            );
        }
        function setMinimalFeed() {
            minimalFeed.value = !minimalFeed.value;
            configRepository.setBool('VRCX-0_minimalFeed', minimalFeed.value);
        }
        function setHideDevicesFromFeed() {
            hideDevicesFromFeed.value = !hideDevicesFromFeed.value;
            configRepository.setBool(
                'VRCX-0_hideDevicesFromFeed',
                hideDevicesFromFeed.value
            );
        }
        function setVrOverlayCpuUsage() {
            vrOverlayCpuUsage.value = !vrOverlayCpuUsage.value;
            configRepository.setBool(
                'VRCX-0_vrOverlayCpuUsage',
                vrOverlayCpuUsage.value
            );
        }
        function setHideUptimeFromFeed() {
            hideUptimeFromFeed.value = !hideUptimeFromFeed.value;
            configRepository.setBool(
                'VRCX-0_hideUptimeFromFeed',
                hideUptimeFromFeed.value
            );
        }
        function setPcUptimeOnFeed() {
            pcUptimeOnFeed.value = !pcUptimeOnFeed.value;
            configRepository.setBool(
                'VRCX-0_pcUptimeOnFeed',
                pcUptimeOnFeed.value
            );
        }

        initWristOverlaySettings();

        return {
            overlayWrist,
            hidePrivateFromFeed,
            openVRAlways,
            overlaybutton,
            overlayHand,
            vrBackgroundEnabled,
            minimalFeed,
            hideDevicesFromFeed,
            vrOverlayCpuUsage,
            hideUptimeFromFeed,
            pcUptimeOnFeed,

            setOverlayWrist,
            setHidePrivateFromFeed,
            setOpenVRAlways,
            setOverlaybutton,
            setOverlayHand,
            setVrBackgroundEnabled,
            setMinimalFeed,
            setHideDevicesFromFeed,
            setVrOverlayCpuUsage,
            setHideUptimeFromFeed,
            setPcUptimeOnFeed
        };
    }
);
