import { X } from 'lucide-react';
import { Popover } from 'radix-ui';
import { type KeyboardEvent, type ReactNode, useRef, useState } from 'react';
import { fieldClass } from '@/components/ui/input';
import { optionClass, panelClass } from '@/components/ui/select';
import { cn } from '@/lib/utils';

export interface Tag {
    /** Unique across every kind, e.g. "crew:static-wolves" */
    key: string;
    label: string;
    /** Shown on the right in the list and on the chip, e.g. "crew" */
    kind: string;
    icon?: ReactNode;
}

const MAX_SHOWN = 8;

/** Matches what's typed against labels and kinds. Labels starting with it come first. */
function match(options: Tag[], typed: string): Tag[] {
    const q = typed.trim().toLowerCase();
    if (!q) return options.slice(0, MAX_SHOWN);
    const hits = options.filter((o) => o.label.toLowerCase().includes(q) || o.kind.toLowerCase().startsWith(q));
    const starts = (o: Tag) => (o.label.toLowerCase().startsWith(q) ? 0 : 1);
    return hits.sort((a, b) => starts(a) - starts(b)).slice(0, MAX_SHOWN);
}

/**
 * Picked things as chips in a text box. Typing lists matches to add; Backspace in an empty
 * box takes the last chip off.
 */
export function TagInput({ id, options, value, onChange, placeholder }: { id: string; options: Tag[]; value: string[]; onChange: (keys: string[]) => void; placeholder?: string }) {
    const [typed, setTyped] = useState('');
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(0);
    const input = useRef<HTMLInputElement>(null);

    const byKey = new Map(options.map((o) => [o.key, o]));
    const picked = value.map((k) => byKey.get(k)).filter((t): t is Tag => !!t);
    const matches = match(
        options.filter((o) => !value.includes(o.key)),
        typed,
    );
    const show = open && matches.length > 0;

    const add = (tag: Tag) => {
        onChange([...value, tag.key]);
        setTyped('');
        setActive(0);
    };
    const remove = (key: string) => onChange(value.filter((k) => k !== key));

    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
            const step = e.key === 'ArrowDown' ? 1 : -1;
            setActive((i) => (i + step + matches.length) % matches.length);
        } else if (e.key === 'Enter' && show) {
            e.preventDefault();
            add(matches[active] ?? matches[0]);
        } else if (e.key === 'Backspace' && !typed && value.length) {
            remove(value[value.length - 1]);
        } else if (e.key === 'Escape') {
            setOpen(false);
        }
    };

    return (
        <Popover.Root open={show} onOpenChange={setOpen}>
            <Popover.Anchor asChild>
                {/* The whole box focuses the text field */}
                <div className={cn(fieldClass, 'flex min-h-9 cursor-text flex-wrap items-center gap-1.5 py-1.5 focus-within:border-primary')} onClick={() => input.current?.focus()}>
                    {picked.map((t) => (
                        <span key={t.key} className="cut inline-flex items-center gap-1.5 bg-primary/20 py-0.5 pr-1 pl-2 text-xs text-primary [--cut:4px]">
                            {t.icon}
                            <span className="max-w-48 truncate">{t.label}</span>
                            <span className="text-[10px] tracking-wider text-primary/70 uppercase">{t.kind}</span>
                            <button
                                type="button"
                                aria-label={`Remove ${t.label}`}
                                className="cursor-pointer p-0.5 hover:text-foreground"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    remove(t.key);
                                }}
                            >
                                <X className="size-3" />
                            </button>
                        </span>
                    ))}
                    <input
                        ref={input}
                        id={id}
                        value={typed}
                        placeholder={picked.length ? '' : placeholder}
                        autoComplete="off"
                        role="combobox"
                        aria-expanded={show}
                        aria-controls={`${id}-list`}
                        aria-autocomplete="list"
                        className="h-6 min-w-24 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
                        onChange={(e) => {
                            setTyped(e.target.value);
                            setOpen(true);
                            setActive(0);
                        }}
                        onFocus={() => setOpen(true)}
                        onBlur={() => setOpen(false)}
                        onKeyDown={onKeyDown}
                    />
                </div>
            </Popover.Anchor>
            <Popover.Portal>
                <Popover.Content
                    side="bottom"
                    align="start"
                    sideOffset={4}
                    onOpenAutoFocus={(e) => e.preventDefault()}
                    onCloseAutoFocus={(e) => e.preventDefault()}
                    className="z-50 w-(--radix-popover-trigger-width)"
                >
                    <ul id={`${id}-list`} role="listbox" className={panelClass}>
                        {matches.map((t, i) => (
                            <li
                                key={t.key}
                                role="option"
                                aria-selected={i === active}
                                // mousedown, not click, so the box keeps focus
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    add(t);
                                }}
                                onMouseEnter={() => setActive(i)}
                                className={optionClass}
                            >
                                {t.icon}
                                <span className="truncate">{t.label}</span>
                                <span className="ml-auto text-xs tracking-wider text-muted-foreground uppercase group-aria-selected:text-primary-foreground/70">{t.kind}</span>
                            </li>
                        ))}
                    </ul>
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}
