import type { Table as ReactTable } from '@tanstack/react-table';
import type { ReactNode } from 'react';
import {
    CalendarRangeIcon,
    LogsIcon,
    RefreshCwIcon,
    SearchIcon,
    StarIcon,
    Table2Icon,
    XIcon
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { TableColumnVisibilityMenu } from '@/components/data-table/TableColumnVisibilityMenu';
import { Button } from '@/ui/shadcn/button';
import { Calendar } from '@/ui/shadcn/calendar';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput
} from '@/ui/shadcn/input-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';
import { Spinner } from '@/ui/shadcn/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/ui/shadcn/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { GAME_LOG_SESSION_DATE_RANGE_MAX_DAYS } from '../gameLogDateRange';
import type {
    GameLogDateRange,
    GameLogFilterType,
    GameLogLoadStatus,
    GameLogRow,
    GameLogViewMode
} from '../gameLogTypes';
import {
    TypeFilterDropdown,
    TypeFilterToggleGroup
} from './GameLogTableParts';

function GameLogViewModeToggle({
    viewMode,
    onViewModeChange
}: {
    onViewModeChange(viewMode: GameLogViewMode): void;
    viewMode: GameLogViewMode;
}) {
    const { t } = useTranslation();
    const sessionsLabel = t('view.game_log.label.sessions');
    const tableLabel = t('view.game_log.label.table');

    return (
        <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={viewMode}
            onValueChange={(nextValue) => {
                if (nextValue) {
                    onViewModeChange(nextValue as GameLogViewMode);
                }
            }}
            className="shrink-0"
        >
            <Tooltip>
                <TooltipTrigger asChild>
                    <ToggleGroupItem
                        value="sessions"
                        aria-label={sessionsLabel}
                    >
                        <LogsIcon data-icon="inline-start" />
                    </ToggleGroupItem>
                </TooltipTrigger>
                <TooltipContent>{sessionsLabel}</TooltipContent>
            </Tooltip>
            <Tooltip>
                <TooltipTrigger asChild>
                    <ToggleGroupItem
                        value="table"
                        aria-label={tableLabel}
                    >
                        <Table2Icon data-icon="inline-start" />
                    </ToggleGroupItem>
                </TooltipTrigger>
                <TooltipContent>{tableLabel}</TooltipContent>
            </Tooltip>
        </ToggleGroup>
    );
}

function GameLogFavoritesToggle({
    favoritesOnly,
    onToggle
}: {
    favoritesOnly: boolean;
    onToggle(): void;
}) {
    const { t } = useTranslation();
    const label = t('view.game_log.label.favorites_only');

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    type="button"
                    variant={favoritesOnly ? 'default' : 'outline'}
                    size="icon-sm"
                    aria-label={label}
                    onClick={onToggle}
                >
                    <StarIcon data-icon="inline-start" />
                </Button>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}

function GameLogSessionDateFilter({
    open,
    onOpenChange,
    sessionDateFrom,
    sessionDateTo,
    sessionDateDraftFrom,
    sessionDateDraftTo,
    sessionDateDraftRange,
    todayDate,
    onRangeSelect,
    onClear,
    onApply
}: {
    onApply(): void;
    onClear(): void;
    onOpenChange(open: boolean): void;
    onRangeSelect(range?: GameLogDateRange): void;
    open: boolean;
    sessionDateDraftFrom: string;
    sessionDateDraftRange?: GameLogDateRange;
    sessionDateDraftTo: string;
    sessionDateFrom: string;
    sessionDateTo: string;
    todayDate: Date;
}) {
    const { t } = useTranslation();
    const label = t('view.game_log.label.session_date_range');
    const dateRangeLabel =
        sessionDateFrom || sessionDateTo
            ? [sessionDateFrom || '...', sessionDateTo || '...'].join(' - ')
            : label;

    return (
        <Popover open={open} onOpenChange={onOpenChange}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <PopoverTrigger asChild>
                        <InputGroupButton
                            type="button"
                            size="icon-xs"
                            variant={
                                sessionDateFrom || sessionDateTo
                                    ? 'secondary'
                                    : 'ghost'
                            }
                            aria-label={dateRangeLabel}
                            onMouseDown={(event) => event.preventDefault()}
                        >
                            <CalendarRangeIcon data-icon="icon" />
                        </InputGroupButton>
                    </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent>{dateRangeLabel}</TooltipContent>
            </Tooltip>
            <PopoverContent className="w-auto" align="end">
                <Calendar
                    mode="range"
                    numberOfMonths={2}
                    max={GAME_LOG_SESSION_DATE_RANGE_MAX_DAYS}
                    selected={sessionDateDraftRange}
                    disabled={{ after: todayDate }}
                    onSelect={onRangeSelect}
                />
                <div className="flex items-center justify-between gap-4 px-3 pb-3">
                    <div className="text-muted-foreground min-w-0 text-xs">
                        {[
                            sessionDateDraftFrom || '...',
                            sessionDateDraftTo || '...'
                        ].join(' - ')}
                        <span className="ml-2">
                            {t('view.game_log.label.max')}{' '}
                            {GAME_LOG_SESSION_DATE_RANGE_MAX_DAYS}{' '}
                            {t('view.game_log.label.days')}
                        </span>
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={onClear}
                        >
                            {t('common.actions.clear')}
                        </Button>
                        <Button type="button" size="sm" onClick={onApply}>
                            {t('common.actions.confirm')}
                        </Button>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}

function GameLogSearchInput({
    dateFilterControl = null,
    value,
    onChange,
    onCommit,
    onClear
}: {
    dateFilterControl?: ReactNode;
    onChange(value: string): void;
    onClear(): void;
    onCommit(): void;
    value: string;
}) {
    const { t } = useTranslation();
    return (
        <InputGroup className="order-last w-full min-w-0 sm:order-none sm:ml-auto sm:w-60 sm:shrink-0">
            <InputGroupAddon>
                <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onBlur={onCommit}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        onCommit();
                    }
                }}
                placeholder={t('common.actions.search')}
            />
            {value || dateFilterControl ? (
                <InputGroupAddon align="inline-end" className="gap-1">
                    {value ? (
                        <InputGroupButton
                            type="button"
                            size="icon-xs"
                            aria-label={t('common.actions.clear')}
                            onMouseDown={(event: any) =>
                                event.preventDefault()
                            }
                            onClick={onClear}
                        >
                            <XIcon data-icon="icon" />
                        </InputGroupButton>
                    ) : null}
                    {dateFilterControl}
                </InputGroupAddon>
            ) : null}
        </InputGroup>
    );
}

function GameLogToolbarControls({
    canRefresh,
    loadStatus,
    onRefresh,
    showColumnVisibilityMenu,
    table
}: {
    canRefresh: boolean;
    loadStatus: GameLogLoadStatus;
    onRefresh(): void;
    showColumnVisibilityMenu: boolean;
    table: ReactTable<GameLogRow>;
}) {
    const { t } = useTranslation();
    return (
        <div className="flex shrink-0 items-center gap-2">
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        aria-label={t('common.actions.refresh')}
                        disabled={!canRefresh || loadStatus === 'running'}
                        onClick={onRefresh}
                    >
                        {loadStatus === 'running' ? (
                            <Spinner data-icon="inline-start" />
                        ) : (
                            <RefreshCwIcon data-icon="inline-start" />
                        )}
                    </Button>
                </TooltipTrigger>
                <TooltipContent>{t('common.actions.refresh')}</TooltipContent>
            </Tooltip>
            {showColumnVisibilityMenu ? (
                <TableColumnVisibilityMenu table={table} />
            ) : null}
        </div>
    );
}

export function GameLogToolbar({
    filterModel,
    refreshModel,
    table
}: {
    filterModel: {
        availableFilterTypes: readonly GameLogFilterType[];
        favoritesOnly: boolean;
        queryFilterTypes: readonly GameLogFilterType[];
        searchDraft: string;
        sessionDateDraftFrom: string;
        sessionDateDraftRange?: GameLogDateRange;
        sessionDateDraftTo: string;
        sessionDateFrom: string;
        sessionDatePopoverOpen: boolean;
        sessionDateTo: string;
        todayDate: Date;
        viewMode: GameLogViewMode;
        applySessionDateRange(): void;
        changeViewMode(viewMode: GameLogViewMode): void;
        clearSearch(): void;
        clearSessionDateRange(): void;
        commitSearchDraft(): void;
        handleSessionDatePopoverChange(open: boolean): void;
        setActiveSelectedTypes(types: GameLogFilterType[]): void;
        setSearchDraft(value: string): void;
        toggleFavoritesOnly(): void;
        updateSessionDateDraftRange(range?: GameLogDateRange): void;
    };
    refreshModel: {
        canRefresh: boolean;
        loadStatus: GameLogLoadStatus;
        onRefresh(): void;
    };
    table: ReactTable<GameLogRow>;
}) {
    const {
        availableFilterTypes,
        favoritesOnly,
        queryFilterTypes,
        searchDraft,
        sessionDateDraftFrom,
        sessionDateDraftRange,
        sessionDateDraftTo,
        sessionDateFrom,
        sessionDatePopoverOpen,
        sessionDateTo,
        todayDate,
        viewMode,
        applySessionDateRange,
        changeViewMode,
        clearSearch,
        clearSessionDateRange,
        commitSearchDraft,
        handleSessionDatePopoverChange,
        setActiveSelectedTypes,
        setSearchDraft,
        toggleFavoritesOnly,
        updateSessionDateDraftRange
    } = filterModel;
    const { canRefresh, loadStatus, onRefresh } = refreshModel;
    const isTableView = viewMode === 'table';

    return (
        <div className="overflow-hidden pb-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
                <div className="flex shrink-0 items-center gap-2">
                    <GameLogViewModeToggle
                        viewMode={viewMode}
                        onViewModeChange={changeViewMode}
                    />
                    <GameLogFavoritesToggle
                        favoritesOnly={favoritesOnly}
                        onToggle={toggleFavoritesOnly}
                    />
                </div>
                {isTableView ? (
                    <div className="min-w-44">
                        <TypeFilterDropdown
                            types={availableFilterTypes}
                            selectedTypes={queryFilterTypes}
                            onSelectedTypesChange={setActiveSelectedTypes}
                        />
                    </div>
                ) : (
                    <TypeFilterToggleGroup
                        types={availableFilterTypes}
                        selectedTypes={queryFilterTypes}
                        onSelectedTypesChange={setActiveSelectedTypes}
                        className="flex min-w-0 flex-wrap items-center gap-1"
                    />
                )}
                <GameLogSearchInput
                    dateFilterControl={
                        isTableView ? null : (
                            <GameLogSessionDateFilter
                                open={sessionDatePopoverOpen}
                                onOpenChange={handleSessionDatePopoverChange}
                                sessionDateFrom={sessionDateFrom}
                                sessionDateTo={sessionDateTo}
                                sessionDateDraftFrom={sessionDateDraftFrom}
                                sessionDateDraftTo={sessionDateDraftTo}
                                sessionDateDraftRange={sessionDateDraftRange}
                                todayDate={todayDate}
                                onRangeSelect={updateSessionDateDraftRange}
                                onClear={clearSessionDateRange}
                                onApply={applySessionDateRange}
                            />
                        )
                    }
                    value={searchDraft}
                    onChange={setSearchDraft}
                    onCommit={commitSearchDraft}
                    onClear={clearSearch}
                />
                <GameLogToolbarControls
                    canRefresh={canRefresh}
                    loadStatus={loadStatus}
                    onRefresh={onRefresh}
                    showColumnVisibilityMenu={isTableView}
                    table={table}
                />
            </div>
        </div>
    );
}
