import { CalendarRangeIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { DateRange } from 'react-day-picker';

import { Button } from '@/ui/shadcn/button';
import { Calendar } from '@/ui/shadcn/calendar';
import { Label } from '@/ui/shadcn/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';

import {
    buildDateTimeRange,
    toTimeValue,
    stripTime,
    type DateTimeRangeValue
} from './dateTimeRange';

export type { DateTimeRangeValue } from './dateTimeRange';

interface DateTimeRangePickerProps {
    value: DateTimeRangeValue;
    onChange: (value: DateTimeRangeValue) => void;
    placeholder: string;
    startLabel: string;
    endLabel: string;
    clearLabel: string;
    confirmLabel: string;
    formatValue?: (date: Date) => string;
    numberOfMonths?: number;
    disabled?: any;
    align?: 'start' | 'center' | 'end';
    triggerClassName?: string;
}

function twoDigitOptions(count: number) {
    return Array.from({ length: count }, (_, index) =>
        String(index).padStart(2, '0')
    );
}

const HOUR_OPTIONS = twoDigitOptions(24);
const MINUTE_OPTIONS = twoDigitOptions(60);

function TimeSelect({
    value,
    onChange,
    label
}: {
    value: string;
    onChange: (next: string) => void;
    label: string;
}) {
    const [hour = '00', minute = '00'] = value.split(':');

    return (
        <div className="flex items-center gap-1">
            <Select
                value={hour}
                onValueChange={(next: string) => onChange(`${next}:${minute}`)}
            >
                <SelectTrigger size="sm" className="w-16" aria-label={label}>
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup>
                        {HOUR_OPTIONS.map((option) => (
                            <SelectItem key={option} value={option}>
                                {option}
                            </SelectItem>
                        ))}
                    </SelectGroup>
                </SelectContent>
            </Select>
            <span className="text-muted-foreground">:</span>
            <Select
                value={minute}
                onValueChange={(next: string) => onChange(`${hour}:${next}`)}
            >
                <SelectTrigger size="sm" className="w-16" aria-label={label}>
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup>
                        {MINUTE_OPTIONS.map((option) => (
                            <SelectItem key={option} value={option}>
                                {option}
                            </SelectItem>
                        ))}
                    </SelectGroup>
                </SelectContent>
            </Select>
        </div>
    );
}

function defaultFormat(date: Date) {
    return date.toLocaleString(undefined, {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

export function DateTimeRangePicker({
    value,
    onChange,
    placeholder,
    startLabel,
    endLabel,
    clearLabel,
    confirmLabel,
    formatValue = defaultFormat,
    numberOfMonths = 2,
    disabled,
    align = 'start',
    triggerClassName
}: DateTimeRangePickerProps) {
    const [open, setOpen] = useState(false);
    const [draftRange, setDraftRange] = useState<DateRange | undefined>(
        undefined
    );
    const [startTime, setStartTime] = useState('00:00');
    const [endTime, setEndTime] = useState('23:59');

    const active = Boolean(value.from || value.to);

    useEffect(() => {
        if (!open) {
            return;
        }
        setDraftRange(
            value.from
                ? {
                      from: stripTime(value.from),
                      to: value.to ? stripTime(value.to) : undefined
                  }
                : undefined
        );
        setStartTime(toTimeValue(value.from, '00:00'));
        setEndTime(toTimeValue(value.to, '23:59'));
    }, [open, value.from, value.to]);

    function apply() {
        onChange(buildDateTimeRange(draftRange, startTime, endTime));
        setOpen(false);
    }

    function clear() {
        setDraftRange(undefined);
        setStartTime('00:00');
        setEndTime('23:59');
        onChange({ from: null, to: null });
        setOpen(false);
    }

    const triggerLabel = useMemo(() => {
        if (!value.from) {
            return placeholder;
        }
        return `${formatValue(value.from)} - ${value.to ? formatValue(value.to) : '...'}`;
    }, [formatValue, placeholder, value.from, value.to]);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant={active ? 'secondary' : 'outline'}
                    className={triggerClassName}
                >
                    <CalendarRangeIcon data-icon="inline-start" />
                    <span className="truncate">{triggerLabel}</span>
                </Button>
            </PopoverTrigger>
            <PopoverContent align={align} className="w-auto p-0">
                <Calendar
                    mode="range"
                    numberOfMonths={numberOfMonths}
                    selected={draftRange}
                    disabled={disabled}
                    onSelect={setDraftRange}
                />
                <div className="grid grid-cols-2 gap-3 px-3 pb-2">
                    <div className="flex flex-col gap-1.5">
                        <Label className="text-muted-foreground text-xs">
                            {startLabel}
                        </Label>
                        <TimeSelect
                            value={startTime}
                            onChange={setStartTime}
                            label={startLabel}
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label className="text-muted-foreground text-xs">
                            {endLabel}
                        </Label>
                        <TimeSelect
                            value={endTime}
                            onChange={setEndTime}
                            label={endLabel}
                        />
                    </div>
                </div>
                <div className="flex justify-end gap-2 px-3 pb-3">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={clear}
                    >
                        {clearLabel}
                    </Button>
                    <Button type="button" size="sm" onClick={apply}>
                        {confirmLabel}
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    );
}
