import { Popover } from 'radix-ui';
import { type KeyboardEvent, useState } from 'react';
import { Input } from '@/components/ui/input';
import { optionClass, panelClass } from '@/components/ui/select';

export interface Suggestion {
    value: string;
    /** Shown on the right, and searched too. */
    hint?: string;
}

const MAX_SHOWN = 8;

/** Filters suggestions by what's typed. Names starting with it come first. */
function match(suggestions: Suggestion[], typed: string): Suggestion[] {
    const q = typed.trim().toLowerCase();
    if (!q) return suggestions.slice(0, MAX_SHOWN);
    const hits = suggestions.filter((s) => s.value.toLowerCase().includes(q) || s.hint?.toLowerCase().includes(q));
    const starts = (s: Suggestion) => (s.value.toLowerCase().startsWith(q) ? 0 : 1);
    return hits.sort((a, b) => starts(a) - starts(b)).slice(0, MAX_SHOWN);
}

/**
 * A text box with a list of suggestions under it. Free text is still allowed.
 * The list opens in a portal so cut-corner cards don't clip it.
 */
export function Combobox({
    id,
    value,
    onChange,
    suggestions,
    maxLength,
}: {
    id: string;
    value: string;
    onChange: (value: string) => void;
    suggestions: Suggestion[];
    maxLength?: number;
}) {
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(0);

    const matches = match(suggestions, value);
    const exact = matches.length === 1 && matches[0].value.toLowerCase() === value.trim().toLowerCase();
    const show = open && matches.length > 0 && !exact;

    const pick = (s: Suggestion) => {
        onChange(s.value);
        setOpen(false);
    };

    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
            const step = e.key === 'ArrowDown' ? 1 : -1;
            setActive((i) => (i + step + matches.length) % matches.length);
        } else if (e.key === 'Enter' && show) {
            e.preventDefault();
            pick(matches[active] ?? matches[0]);
        } else if (e.key === 'Escape') {
            setOpen(false);
        }
    };

    return (
        <Popover.Root open={show} onOpenChange={setOpen}>
            <Popover.Anchor asChild>
                <Input
                    id={id}
                    value={value}
                    maxLength={maxLength}
                    autoComplete="off"
                    role="combobox"
                    aria-expanded={show}
                    aria-controls={`${id}-list`}
                    aria-autocomplete="list"
                    onChange={(e) => {
                        onChange(e.target.value);
                        setOpen(true);
                        setActive(0);
                    }}
                    onFocus={() => setOpen(true)}
                    onBlur={() => setOpen(false)}
                    onKeyDown={onKeyDown}
                />
            </Popover.Anchor>
            <Popover.Portal>
                <Popover.Content
                    side="bottom"
                    align="start"
                    sideOffset={4}
                    // Keep typing in the box while the list is open
                    onOpenAutoFocus={(e) => e.preventDefault()}
                    onCloseAutoFocus={(e) => e.preventDefault()}
                    className="z-50 w-(--radix-popover-trigger-width)"
                >
                    <ul id={`${id}-list`} role="listbox" className={panelClass}>
                        {matches.map((s, i) => (
                            <li
                                key={`${s.value}-${s.hint}`}
                                role="option"
                                aria-selected={i === active}
                                // mousedown, not click, so the box doesn't lose focus first
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    pick(s);
                                }}
                                onMouseEnter={() => setActive(i)}
                                className={optionClass}
                            >
                                <span>{s.value}</span>
                                {s.hint && <span className="ml-auto text-xs tracking-wider text-muted-foreground uppercase">{s.hint}</span>}
                            </li>
                        ))}
                    </ul>
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}
