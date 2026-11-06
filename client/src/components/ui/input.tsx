import type { ComponentProps } from 'react';
import { Help } from '@/components/common';
import { cn } from '@/lib/utils';

export const fieldClass =
    'cut w-full border-b-3 border-input bg-muted px-3 text-sm outline-none [--cut:8px] placeholder:text-muted-foreground focus:border-primary aria-invalid:border-destructive aria-invalid:shadow-[inset_0_0_0_2px_var(--color-destructive)]';

/** Limits only show once you're close: within the last 10%. */
const nearLimit = (length: number, max?: number) => !!max && length >= max * 0.9;

/** "38 / 40", for a field that's nearly full. Red once it's full or over. */
export function CharCount({ length, max, className }: { length: number; max: number; className?: string }) {
    if (!nearLimit(length, max)) return null;
    return <span className={cn('text-xs tabular-nums', length >= max ? 'text-destructive' : 'text-accent', className)}>{`${length} / ${max}`}</span>;
}

export function Input({ className, ...props }: ComponentProps<'input'>) {
    const length = String(props.value ?? '').length;
    const input = <input className={cn(fieldClass, 'h-9', nearLimit(length, props.maxLength) && 'pr-24', className)} {...props} />;
    if (!props.maxLength) return input;
    return (
        <div className="relative w-full min-w-0">
            {input}
            <CharCount length={length} max={props.maxLength} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2" />
        </div>
    );
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
    const length = String(props.value ?? '').length;
    const textarea = <textarea className={cn(fieldClass, 'min-h-20 py-2', nearLimit(length, props.maxLength) && 'pb-6', className)} {...props} />;
    if (!props.maxLength) return textarea;
    return (
        <div className="relative w-full min-w-0">
            {textarea}
            <CharCount length={length} max={props.maxLength} className="pointer-events-none absolute right-3 bottom-2" />
        </div>
    );
}

/** A field's label. `help` adds a "?" with an explanation next to it (outside the label, which can't hold a button). */
export function Label({ className, help, ...props }: ComponentProps<'label'> & { help?: string }) {
    const label = <label className={cn('mb-1 block font-display text-xs tracking-widest text-muted-foreground uppercase', help && 'mb-0', className)} {...props} />;
    if (!help) return label;
    return (
        <div className="mb-1 flex items-center gap-2">
            {label}
            <Help>{help}</Help>
        </div>
    );
}
