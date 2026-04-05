import { defineStore } from 'pinia';

export const useVrStore = defineStore('Vr', () => {
    // VR overlay integration was removed; keep no-op hooks for callers.
    function vrInit() {}
    function saveOpenVROption() {}
    function updateVrNowPlaying() {}
    function updateVRLastLocation() {}
    function updateVRConfigVars() {}
    function updateOpenVR() {}

    return {
        vrInit,
        saveOpenVROption,
        updateVrNowPlaying,
        updateVRLastLocation,
        updateVRConfigVars,
        updateOpenVR
    };
});
