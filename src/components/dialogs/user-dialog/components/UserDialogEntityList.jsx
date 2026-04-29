import { UserIcon } from 'lucide-react';

import { timeToText } from '@/lib/dateTime.js';
import { userStatusDotClassName } from '@/lib/userStatus.js';
import { cn } from '@/lib/utils.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';

import {
    summarizeEntityRow,
    userRowSubtitle,
    userTravelingTimestamp,
    worldOccupantSubtitle
} from '../userDialogRows.js';
import { rowImage } from './userDialogEntityImages.js';
import { EntityListState } from './UserDialogEntityListState.jsx';
import { openRow } from './userDialogEntityNavigation.js';
import { UserGroupCard } from './UserDialogGroupCard.jsx';

export function EntityList({ rows, kind = '', loading = false, error = '' }) {
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );

    if (loading) {
        return <EntityListState kind={kind} loading />;
    }
    if (error) {
        return <EntityListState kind={kind} error={error} />;
    }
    if (!rows.length) {
        return <EntityListState kind={kind} />;
    }

    const nowMs = Date.now();

    return (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] items-start gap-1">
            {rows.map((row, index) => {
                if (kind === 'group') {
                    return (
                        <UserGroupCard
                            key={`${row?.id || row?.groupId || row?.name || 'group'}:${index}`}
                            group={row}
                            currentEndpoint={currentEndpoint}
                        />
                    );
                }

                const image = rowImage(row, kind);
                const label =
                    kind === 'user'
                        ? row?.displayName || row?.username || ''
                        : summarizeEntityRow(row);
                const subtitle =
                    kind === 'user'
                        ? userRowSubtitle(row, nowMs)
                        : kind === 'world'
                          ? worldOccupantSubtitle(row)
                          : row?.description || '';
                const imageRoundedClassName =
                    kind === 'user' ? 'rounded-full' : 'rounded-md';
                const travelingTimestamp =
                    kind === 'user' ? userTravelingTimestamp(row) : 0;
                const dotClassName =
                    kind === 'user' ? userStatusDotClassName(row) : '';

                return (
                    <Button
                        key={`${row?.id || row?.userId || label}:${index}`}
                        type="button"
                        variant="ghost"
                        className="h-auto min-w-0 justify-start gap-2 px-1.5 py-1.5 text-left font-normal"
                        onClick={() => openRow(row, kind)}
                    >
                        <span className="relative size-9 shrink-0">
                            {image ? (
                                <img
                                    src={image}
                                    alt=""
                                    className={cn(
                                        'size-9 object-cover',
                                        imageRoundedClassName
                                    )}
                                />
                            ) : (
                                <span
                                    className={cn(
                                        'bg-muted flex size-9 items-center justify-center [&>svg]:size-4',
                                        imageRoundedClassName
                                    )}
                                >
                                    <UserIcon className="text-muted-foreground" />
                                </span>
                            )}
                            {dotClassName ? (
                                <span
                                    className={cn(
                                        'border-background absolute right-0 bottom-0 z-10 size-2.5 rounded-full border',
                                        dotClassName
                                    )}
                                />
                            ) : null}
                        </span>
                        <span className="min-w-0 flex-1 overflow-hidden">
                            <span
                                className="block truncate leading-snug font-medium"
                                style={
                                    kind === 'user' && row?.$userColour
                                        ? { color: row.$userColour }
                                        : undefined
                                }
                            >
                                {label || '\u2014'}
                            </span>
                            {travelingTimestamp ? (
                                <span className="text-muted-foreground block truncate text-xs">
                                    <Spinner
                                        data-icon="inline-start"
                                        className="mr-1 inline-block"
                                    />
                                    {timeToText(
                                        Date.now() - travelingTimestamp
                                    )}
                                </span>
                            ) : subtitle ? (
                                <span className="text-muted-foreground block truncate text-xs">
                                    {subtitle}
                                </span>
                            ) : null}
                        </span>
                    </Button>
                );
            })}
        </div>
    );
}

export function UserGroupSection({ title, rows, countText }) {
    if (!rows.length) {
        return null;
    }

    return (
        <section className="flex flex-col gap-2">
            <div className="flex items-baseline gap-1.5">
                <span className="text-base font-bold">{title}</span>
                <span className="text-muted-foreground text-xs">
                    {countText || rows.length}
                </span>
            </div>
            <EntityList rows={rows} kind="group" />
        </section>
    );
}
