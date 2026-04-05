<template>
    <div class="flex flex-col gap-10 py-2">
        <SettingsGroup :title="t('view.settings.vr.vr_notifications.header')">
            <SettingsItem :label="t('view.settings.notifications.notifications.desktop_notifications.when_to_display_vr')">
                <ToggleGroup
                    type="single"
                    required
                    variant="outline"
                    size="sm"
                    :model-value="overlayToast"
                    @update:model-value="setOverlayToast">
                    <ToggleGroupItem value="Never">{{
                        t('view.settings.notifications.notifications.conditions.never')
                    }}</ToggleGroupItem>
                    <ToggleGroupItem value="Game Running">{{
                        t('view.settings.notifications.notifications.conditions.inside_vrchat')
                    }}</ToggleGroupItem>
                    <ToggleGroupItem value="Game Closed">{{
                        t('view.settings.notifications.notifications.conditions.outside_vrchat')
                    }}</ToggleGroupItem>
                    <ToggleGroupItem value="Always">{{
                        t('view.settings.notifications.notifications.conditions.always')
                    }}</ToggleGroupItem>
                </ToggleGroup>
            </SettingsItem>

            <SettingsItem
                :label="
                    t('view.settings.notifications.notifications.steamvr_notifications.xsoverlay_notifications')
                ">
                <Switch :model-value="xsNotifications" @update:modelValue="setXsNotifications" />
            </SettingsItem>

            <SettingsItem
                :label="
                    t(
                        'view.settings.notifications.notifications.steamvr_notifications.ovrtoolkit_hud_notifications'
                    )
                ">
                <Switch
                    :model-value="ovrtHudNotifications"
                    @update:modelValue="setOvrtHudNotifications" />
            </SettingsItem>

            <SettingsItem
                :label="
                    t(
                        'view.settings.notifications.notifications.steamvr_notifications.ovrtoolkit_wrist_notifications'
                    )
                ">
                <Switch
                    :model-value="ovrtWristNotifications"
                    @update:modelValue="setOvrtWristNotifications" />
            </SettingsItem>

            <SettingsItem
                :label="t('view.settings.notifications.notifications.steamvr_notifications.notification_timeout')">
                <NumberField
                    :model-value="notificationTimeoutSeconds"
                    :min="0"
                    :step="1"
                    :format-options="{ maximumFractionDigits: 0 }"
                    class="w-32"
                    @update:modelValue="setNotificationTimeout">
                    <NumberFieldContent>
                        <NumberFieldDecrement />
                        <NumberFieldInput />
                        <NumberFieldIncrement />
                    </NumberFieldContent>
                </NumberField>
            </SettingsItem>

            <SettingsItem
                :label="t('view.settings.notifications.notifications.steamvr_notifications.notification_opacity')">
                <div class="w-75 max-w-full pt-1">
                    <Slider v-model="notificationOpacityValue" :min="0" :max="100" />
                </div>
            </SettingsItem>

            <SettingsItem
                :label="t('view.settings.notifications.notifications.steamvr_notifications.user_images')"
                :description="t('view.settings.notifications.notifications.steamvr_notifications.user_images_description')">
                <Switch :model-value="imageNotifications" @update:modelValue="setImageNotifications" />
            </SettingsItem>
        </SettingsGroup>
    </div>
</template>

<script setup>
    import { computed } from 'vue';
    import { NumberField, NumberFieldContent, NumberFieldDecrement, NumberFieldIncrement, NumberFieldInput } from '@/components/ui/number-field';
    import { Switch } from '@/components/ui/switch';
    import { Slider } from '@/components/ui/slider';
    import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
    import { storeToRefs } from 'pinia';
    import { useI18n } from 'vue-i18n';

    import { useAdvancedSettingsStore, useNotificationsSettingsStore } from '@/stores';

    import SettingsGroup from '../SettingsGroup.vue';
    import SettingsItem from '../SettingsItem.vue';

    const { t } = useI18n();

    const notificationsSettingsStore = useNotificationsSettingsStore();
    const advancedSettingsStore = useAdvancedSettingsStore();

    const {
        overlayToast,
        xsNotifications,
        ovrtHudNotifications,
        ovrtWristNotifications,
        imageNotifications,
        notificationTimeout
    } = storeToRefs(notificationsSettingsStore);

    const { notificationOpacity } = storeToRefs(advancedSettingsStore);

    const {
        setOverlayToast,
        setXsNotifications,
        setOvrtHudNotifications,
        setOvrtWristNotifications,
        setImageNotifications,
        setNotificationTimeout
    } = notificationsSettingsStore;

    const { setNotificationOpacity } = advancedSettingsStore;

    const notificationTimeoutSeconds = computed(() => notificationTimeout.value / 1000);

    const notificationOpacityValue = computed({
        get: () => [notificationOpacity.value],
        set: (value) => {
            const next = value?.[0];
            if (typeof next === 'number') {
                setNotificationOpacity(next);
            }
        }
    });
</script>
