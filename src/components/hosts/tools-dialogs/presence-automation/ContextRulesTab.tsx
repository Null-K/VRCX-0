import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils.js';
import { userStatusLabel } from '@/lib/userStatus.js';
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle
} from '@/ui/shadcn/empty';
import {
    Field,
    FieldDescription,
    FieldGroup,
    FieldLabel,
    FieldLegend,
    FieldSet
} from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Switch } from '@/ui/shadcn/switch';

import { statusOptions } from '../toolsDialogUtils.js';
import {
    AutomationSplitLayout,
    CompactCheckList,
    RuleEditorPanel,
    RuleList,
    RuleListItem,
    RuleSummaryBadge
} from './AutomationRuleLayout.js';
import { PresenceRuleActionFields } from './PresenceRuleActionFields.js';
import {
    contextPresetLabelKeyFromValue,
    contextPresetOptions,
    createContextRule,
    normalizeContextRule,
    priorityLabelKeyFromNumber,
    priorityNumberFromValue,
    priorityOptions,
    priorityValueFromNumber,
    updateRule
} from './presenceAutomationDialogUtils.js';

const I18N_ROOT = 'view.tools.social_automation';

function hasAction(rule, key) {
    return Object.prototype.hasOwnProperty.call(rule.actions || {}, key);
}

function updateAction(rule, patch) {
    return {
        ...rule,
        actions: {
            ...(rule.actions || {}),
            ...patch
        }
    };
}

function removeAction(rule, key) {
    const actions = { ...(rule.actions || {}) };
    delete actions[key];
    return {
        ...rule,
        actions
    };
}

function parseUserIds(value) {
    return String(value || '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function ruleTitle(rule, t) {
    return rule?.label || t(`${I18N_ROOT}.room_rule_default`);
}

function actionSummary(rule, t) {
    const parts = [];
    if (rule.actions?.status) {
        parts.push(userStatusLabel(rule.actions.status, t));
    }
    if (hasAction(rule, 'statusDescription')) {
        parts.push(t(`${I18N_ROOT}.signature`));
    }
    return parts.length ? parts.join(' / ') : t(`${I18N_ROOT}.do_not_change`);
}

function LegacyStatusEditor({
    id,
    label,
    disabled,
    status,
    descEnabled,
    desc,
    onStatusChange,
    onDescEnabledChange,
    onDescChange
}) {
    const { t } = useTranslation();
    const descEnabledId = `${id}-description-enabled`;

    return (
        <FieldSet
            className="rounded-md border p-2.5"
            disabled={disabled}
            data-disabled={disabled}
        >
            <FieldLegend variant="label">{label}</FieldLegend>
            <FieldGroup>
                <Field>
                    <Select
                        value={status}
                        disabled={disabled}
                        onValueChange={onStatusChange}
                    >
                        <SelectTrigger aria-label={label}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {statusOptions.map((statusOption) => (
                                    <SelectItem
                                        key={statusOption}
                                        value={statusOption}
                                    >
                                        {userStatusLabel(statusOption, t)}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </Field>
                <Field orientation="horizontal" data-disabled={disabled}>
                    <Switch
                        id={descEnabledId}
                        checked={descEnabled}
                        disabled={disabled}
                        onCheckedChange={onDescEnabledChange}
                    />
                    <FieldLabel htmlFor={descEnabledId}>
                        {t(`${I18N_ROOT}.change_signature`)}
                    </FieldLabel>
                </Field>
                {descEnabled ? (
                    <Field data-disabled={disabled}>
                        <Input
                            value={desc}
                            maxLength={32}
                            disabled={disabled}
                            placeholder={t(
                                'view.settings.general.automation.status_description_placeholder'
                            )}
                            onChange={(event) =>
                                onDescChange(event.target.value)
                            }
                        />
                    </Field>
                ) : null}
            </FieldGroup>
        </FieldSet>
    );
}

export function ContextRulesTab({
    values,
    loading,
    groupOptions,
    instanceOptions,
    contextRules,
    onSaveValue,
    onRulesChange
}) {
    const { t } = useTranslation();
    const legacyDisabled = loading || !values.autoStateChangeEnabled;
    const rules = Array.isArray(contextRules) ? contextRules : [];
    const [selectedRuleId, setSelectedRuleId] = useState(null);

    useEffect(() => {
        if (!rules.length) {
            setSelectedRuleId(null);
            return;
        }
        if (!rules.some((rule) => rule.id === selectedRuleId)) {
            setSelectedRuleId(rules[0].id);
        }
    }, [rules, selectedRuleId]);

    const selectedRule = useMemo(
        () => rules.find((rule) => rule.id === selectedRuleId) || null,
        [rules, selectedRuleId]
    );

    function update(ruleId, updater) {
        onRulesChange(
            updateRule(rules, ruleId, (rule) =>
                normalizeContextRule(updater(rule))
            )
        );
    }

    function addRule() {
        const nextRule = createContextRule(t(`${I18N_ROOT}.room_rule_default`));
        setSelectedRuleId(nextRule.id);
        onRulesChange([...rules, nextRule]);
    }

    function removeRule(ruleId) {
        const ruleIndex = rules.findIndex((rule) => rule.id === ruleId);
        const nextRules = rules.filter((rule) => rule.id !== ruleId);
        if (selectedRuleId === ruleId) {
            setSelectedRuleId(
                nextRules[Math.min(ruleIndex, nextRules.length - 1)]?.id ?? null
            );
        }
        onRulesChange(nextRules);
    }

    const customRulesList = (
        <RuleList
            title={t(`${I18N_ROOT}.room_social_rules`)}
            description={t(`${I18N_ROOT}.room_social_rules_description`)}
            addLabel={t(`${I18N_ROOT}.add_rule`)}
            disabled={loading}
            isEmpty={!rules.length}
            emptyTitle={t(`${I18N_ROOT}.no_custom_room_rules`)}
            emptyDescription={t(`${I18N_ROOT}.room_social_rules_description`)}
            onAdd={addRule}
        >
            {rules.map((rule) => (
                <RuleListItem
                    key={rule.id}
                    selected={rule.id === selectedRuleId}
                    title={ruleTitle(rule, t)}
                    description={t(contextPresetLabelKeyFromValue(rule.preset))}
                    enabled={rule.enabled !== false}
                    disabled={loading}
                    removeLabel={t(`${I18N_ROOT}.remove_room_rule`)}
                    badges={
                        <>
                            <RuleSummaryBadge>
                                {t(priorityLabelKeyFromNumber(rule.priority))}
                            </RuleSummaryBadge>
                            <RuleSummaryBadge>
                                {actionSummary(rule, t)}
                            </RuleSummaryBadge>
                        </>
                    }
                    onSelect={() => setSelectedRuleId(rule.id)}
                    onEnabledChange={(checked) =>
                        update(rule.id, (current) => ({
                            ...current,
                            enabled: checked
                        }))
                    }
                    onRemove={() => removeRule(rule.id)}
                />
            ))}
        </RuleList>
    );

    const customRulesEditor = (
        <RuleEditorPanel
            title={
                selectedRule
                    ? ruleTitle(selectedRule, t)
                    : t(`${I18N_ROOT}.room_rule_default`)
            }
            description={
                selectedRule
                    ? t(contextPresetLabelKeyFromValue(selectedRule.preset))
                    : t(`${I18N_ROOT}.no_custom_room_rules`)
            }
        >
            {selectedRule ? (
                <FieldGroup>
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem]">
                        <Field>
                            <FieldLabel>{t(`${I18N_ROOT}.rule_name`)}</FieldLabel>
                            <Input
                                value={selectedRule.label || ''}
                                disabled={loading}
                                onChange={(event) =>
                                    update(selectedRule.id, (current) => ({
                                        ...current,
                                        label: event.target.value
                                    }))
                                }
                            />
                        </Field>
                        <Field>
                            <FieldLabel>{t(`${I18N_ROOT}.priority`)}</FieldLabel>
                            <Select
                                value={priorityValueFromNumber(
                                    selectedRule.priority
                                )}
                                disabled={loading}
                                onValueChange={(value) =>
                                    update(selectedRule.id, (current) => ({
                                        ...current,
                                        priority:
                                            priorityNumberFromValue(value)
                                    }))
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {priorityOptions.map((option) => (
                                            <SelectItem
                                                key={option.value}
                                                value={option.value}
                                            >
                                                {t(option.labelKey)}
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                        </Field>
                    </div>
                    <FieldSet className="rounded-md border p-3">
                        <FieldLegend variant="label">
                            {t(`${I18N_ROOT}.when`)}
                        </FieldLegend>
                        <FieldGroup>
                            <Field>
                                <FieldLabel>{t(`${I18N_ROOT}.when`)}</FieldLabel>
                                <Select
                                    value={selectedRule.preset || 'alone'}
                                    disabled={loading}
                                    onValueChange={(value) =>
                                        update(selectedRule.id, (current) => ({
                                            ...current,
                                            preset: value
                                        }))
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            {contextPresetOptions.map(
                                                (preset) => (
                                                    <SelectItem
                                                        key={preset.value}
                                                        value={preset.value}
                                                    >
                                                        {t(preset.labelKey)}
                                                    </SelectItem>
                                                )
                                            )}
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                            </Field>
                            {selectedRule.preset === 'withSelectedGroups' ? (
                                <Field>
                                    <FieldLabel>
                                        {t(`${I18N_ROOT}.friend_groups`)}
                                    </FieldLabel>
                                    <CompactCheckList
                                        idPrefix={`${selectedRule.id}-groups`}
                                        values={selectedRule.selectedGroups || []}
                                        options={groupOptions}
                                        disabled={loading}
                                        columns="two"
                                        onChange={(next) =>
                                            update(
                                                selectedRule.id,
                                                (current) => ({
                                                    ...current,
                                                    selectedGroups: next
                                                })
                                            )
                                        }
                                    />
                                </Field>
                            ) : null}
                            {selectedRule.preset === 'friendCountAtLeast' ? (
                                <Field>
                                    <FieldLabel>
                                        {t(`${I18N_ROOT}.minimum_friends`)}
                                    </FieldLabel>
                                    <Input
                                        type="number"
                                        min="1"
                                        value={selectedRule.friendCountValue || 1}
                                        disabled={loading}
                                        onChange={(event) =>
                                            update(
                                                selectedRule.id,
                                                (current) => ({
                                                    ...current,
                                                    friendCountValue:
                                                        Number.parseInt(
                                                            event.target.value,
                                                            10
                                                        ) || 1
                                                })
                                            )
                                        }
                                    />
                                </Field>
                            ) : null}
                            {selectedRule.preset === 'playerCountAtLeast' ? (
                                <Field>
                                    <FieldLabel>
                                        {t(`${I18N_ROOT}.minimum_players`)}
                                    </FieldLabel>
                                    <Input
                                        type="number"
                                        min="1"
                                        value={selectedRule.playerCountValue || 1}
                                        disabled={loading}
                                        onChange={(event) =>
                                            update(
                                                selectedRule.id,
                                                (current) => ({
                                                    ...current,
                                                    playerCountValue:
                                                        Number.parseInt(
                                                            event.target.value,
                                                            10
                                                        ) || 1
                                                })
                                            )
                                        }
                                    />
                                </Field>
                            ) : null}
                            {selectedRule.preset === 'withSelectedFriend' ? (
                                <Field>
                                    <FieldLabel>
                                        {t(`${I18N_ROOT}.friend_user_ids`)}
                                    </FieldLabel>
                                    <Input
                                        value={(
                                            selectedRule.specificFriendIds || []
                                        ).join(', ')}
                                        disabled={loading}
                                        placeholder="usr_..., usr_..."
                                        onChange={(event) =>
                                            update(
                                                selectedRule.id,
                                                (current) => ({
                                                    ...current,
                                                    specificFriendIds:
                                                        parseUserIds(
                                                            event.target.value
                                                        )
                                                })
                                            )
                                        }
                                    />
                                </Field>
                            ) : null}
                            <Field>
                                <FieldLabel>
                                    {t(`${I18N_ROOT}.room_types`)}
                                </FieldLabel>
                                <FieldDescription>
                                    {t(`${I18N_ROOT}.room_types_hint`)}
                                </FieldDescription>
                                <CompactCheckList
                                    idPrefix={`${selectedRule.id}-instances`}
                                    values={
                                        selectedRule.selectedInstanceTypes || []
                                    }
                                    options={instanceOptions}
                                    disabled={loading}
                                    columns="two"
                                    onChange={(next) =>
                                        update(selectedRule.id, (current) => ({
                                            ...current,
                                            selectedInstanceTypes: next
                                        }))
                                    }
                                />
                            </Field>
                        </FieldGroup>
                    </FieldSet>
                    <PresenceRuleActionFields
                        idPrefix={selectedRule.id}
                        disabled={loading}
                        status={selectedRule.actions?.status || 'no-change'}
                        statusDescriptionEnabled={hasAction(
                            selectedRule,
                            'statusDescription'
                        )}
                        statusDescription={
                            selectedRule.actions?.statusDescription || ''
                        }
                        onStatusChange={(value) =>
                            update(selectedRule.id, (current) =>
                                value === 'no-change'
                                    ? removeAction(current, 'status')
                                    : updateAction(current, { status: value })
                            )
                        }
                        onStatusDescriptionEnabledChange={(checked) =>
                            update(selectedRule.id, (current) =>
                                checked
                                    ? updateAction(current, {
                                          statusDescription: ''
                                      })
                                    : removeAction(current, 'statusDescription')
                            )
                        }
                        onStatusDescriptionChange={(value) =>
                            update(selectedRule.id, (current) =>
                                updateAction(current, {
                                    statusDescription: value
                                })
                            )
                        }
                    />
                </FieldGroup>
            ) : (
                <Empty className="min-h-[18rem] border">
                    <EmptyHeader>
                        <EmptyTitle>
                            {t(`${I18N_ROOT}.no_custom_room_rules`)}
                        </EmptyTitle>
                        <EmptyDescription>
                            {t(`${I18N_ROOT}.room_social_rules_description`)}
                        </EmptyDescription>
                    </EmptyHeader>
                </Empty>
            )}
        </RuleEditorPanel>
    );

    return (
        <FieldGroup>
            <FieldSet className="bg-card/40 rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <FieldLegend variant="label">
                            {t(`${I18N_ROOT}.legacy_alone_company_mode`)}
                        </FieldLegend>
                        <FieldDescription>
                            {t(`${I18N_ROOT}.legacy_mode_description`)}
                        </FieldDescription>
                    </div>
                    <Switch
                        checked={values.autoStateChangeEnabled}
                        disabled={loading}
                        aria-label={t(
                            `${I18N_ROOT}.enable_legacy_auto_status`
                        )}
                        onCheckedChange={(checked) =>
                            void onSaveValue(
                                'autoStateChangeEnabled',
                                checked,
                                'bool'
                            )
                        }
                    />
                </div>
                <FieldGroup
                    className={cn('mt-3', legacyDisabled && 'opacity-75')}
                >
                    <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,1fr)]">
                        <FieldGroup>
                            <Field data-disabled={legacyDisabled}>
                                <FieldLabel>
                                    {t(`${I18N_ROOT}.alone_condition`)}
                                </FieldLabel>
                                <Select
                                    value={
                                        values.autoStateChangeNoFriends
                                            ? 'noFriends'
                                            : 'alone'
                                    }
                                    disabled={legacyDisabled}
                                    onValueChange={(value) =>
                                        void onSaveValue(
                                            'autoStateChangeNoFriends',
                                            value === 'noFriends',
                                            'bool'
                                        )
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            <SelectItem value="alone">
                                                {t(
                                                    `${I18N_ROOT}.any_player_counts_as_company`
                                                )}
                                            </SelectItem>
                                            <SelectItem value="noFriends">
                                                {t(
                                                    `${I18N_ROOT}.only_friends_count_as_company`
                                                )}
                                            </SelectItem>
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                            </Field>
                            <Field
                                data-disabled={
                                    legacyDisabled ||
                                    !values.autoStateChangeNoFriends
                                }
                            >
                                <FieldLabel>
                                    {t(
                                        `${I18N_ROOT}.friend_groups_counted_as_company`
                                    )}
                                </FieldLabel>
                                <CompactCheckList
                                    idPrefix="autoStateChangeGroups"
                                    values={values.autoStateChangeGroups}
                                    options={groupOptions}
                                    disabled={
                                        legacyDisabled ||
                                        !values.autoStateChangeNoFriends
                                    }
                                    columns="two"
                                    onChange={(next) =>
                                        void onSaveValue(
                                            'autoStateChangeGroups',
                                            next,
                                            'array'
                                        )
                                    }
                                />
                            </Field>
                        </FieldGroup>
                        <Field data-disabled={legacyDisabled}>
                            <FieldLabel>
                                {t(`${I18N_ROOT}.allowed_room_types`)}
                            </FieldLabel>
                            <CompactCheckList
                                idPrefix="autoStateChangeInstanceTypes"
                                values={values.autoStateChangeInstanceTypes}
                                options={instanceOptions}
                                disabled={legacyDisabled}
                                columns="two"
                                onChange={(next) =>
                                    void onSaveValue(
                                        'autoStateChangeInstanceTypes',
                                        next,
                                        'array'
                                    )
                                }
                            />
                        </Field>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                        <LegacyStatusEditor
                            id="auto-state-change-alone-status"
                            label={t(`${I18N_ROOT}.alone_status`)}
                            disabled={legacyDisabled}
                            status={values.autoStateChangeAloneStatus}
                            descEnabled={values.autoStateChangeAloneDescEnabled}
                            desc={values.autoStateChangeAloneDesc}
                            onStatusChange={(value) =>
                                void onSaveValue(
                                    'autoStateChangeAloneStatus',
                                    value
                                )
                            }
                            onDescEnabledChange={(value) =>
                                void onSaveValue(
                                    'autoStateChangeAloneDescEnabled',
                                    value,
                                    'bool'
                                )
                            }
                            onDescChange={(value) =>
                                void onSaveValue(
                                    'autoStateChangeAloneDesc',
                                    value
                                )
                            }
                        />
                        <LegacyStatusEditor
                            id="auto-state-change-company-status"
                            label={t(`${I18N_ROOT}.company_status`)}
                            disabled={legacyDisabled}
                            status={values.autoStateChangeCompanyStatus}
                            descEnabled={
                                values.autoStateChangeCompanyDescEnabled
                            }
                            desc={values.autoStateChangeCompanyDesc}
                            onStatusChange={(value) =>
                                void onSaveValue(
                                    'autoStateChangeCompanyStatus',
                                    value
                                )
                            }
                            onDescEnabledChange={(value) =>
                                void onSaveValue(
                                    'autoStateChangeCompanyDescEnabled',
                                    value,
                                    'bool'
                                )
                            }
                            onDescChange={(value) =>
                                void onSaveValue(
                                    'autoStateChangeCompanyDesc',
                                    value
                                )
                            }
                        />
                    </div>
                </FieldGroup>
            </FieldSet>
            <AutomationSplitLayout
                list={customRulesList}
                editor={customRulesEditor}
            />
        </FieldGroup>
    );
}
