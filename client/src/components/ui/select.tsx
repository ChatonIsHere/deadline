import { ChevronDown } from 'lucide-react';
import { Select as S } from 'radix-ui';
import { fieldClass } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface SelectOption {
    value: string;
    label: string;
    /** Shown on the right, muted. */
    hint?: string;
    /** A colour swatch, e.g. a Discord role colour. */
    color?: string;
}

/** The dropdown panel and its rows. Shared with Combobox so both look the same. */
export const panelClass = 'cut-frame py-1 [--cut:8px] [--frame:var(--color-primary)]';
export const optionClass =
    'flex cursor-pointer items-center gap-2 px-3 py-1.5 outline-none data-highlighted:bg-muted data-highlighted:text-primary aria-selected:bg-muted aria-selected:text-primary';

// Radix can't use '' as an item value (it means "nothing picked"), but our "none" options do.
const NONE = '__none__';
const toItem = (value: string) => (value === '' ? NONE : value);

/** A themed dropdown. `value` is '' for nothing picked (shows the placeholder) or for an option whose value is ''. */
export function Select({
    id,
    value,
    onChange,
    options,
    placeholder,
    disabled,
    className,
}: {
    id?: string;
    value: string;
    onChange: (value: string) => void;
    options: SelectOption[];
    placeholder?: string;
    disabled?: boolean;
    className?: string;
}) {
    const hasEmpty = options.some((o) => o.value === '');
    return (
        <S.Root value={value === '' && !hasEmpty ? '' : toItem(value)} onValueChange={(v) => onChange(v === NONE ? '' : v)} disabled={disabled}>
            <S.Trigger id={id} className={cn(fieldClass, 'flex h-9 cursor-pointer items-center justify-between gap-2 text-left disabled:cursor-default disabled:opacity-60', className)}>
                <span className="truncate">
                    <S.Value placeholder={<span className="text-muted-foreground">{placeholder}</span>} />
                </span>
                <S.Icon>
                    <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                </S.Icon>
            </S.Trigger>
            <S.Portal>
                <S.Content position="popper" sideOffset={4} className="z-50 w-(--radix-select-trigger-width)">
                    <div className={panelClass}>
                        <S.Viewport className="max-h-72">
                            {options.map((o) => (
                                <S.Item key={o.value} value={toItem(o.value)} className={cn(optionClass, 'data-[state=checked]:text-primary')}>
                                    {o.color && <span className="size-2.5 shrink-0" style={{ background: o.color }} />}
                                    <S.ItemText>{o.label}</S.ItemText>
                                    {o.hint && <span className="ml-auto text-xs tracking-wider text-muted-foreground uppercase">{o.hint}</span>}
                                </S.Item>
                            ))}
                        </S.Viewport>
                    </div>
                </S.Content>
            </S.Portal>
        </S.Root>
    );
}
