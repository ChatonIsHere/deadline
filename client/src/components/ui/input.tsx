import type { ComponentProps } from 'react';
import { Help } from '@/components/common';
import { cn } from '@/lib/utils';

export const fieldClass =
    'cut w-full border-b-2 border-input bg-muted px-3 text-sm outline-none [--cut:8px] placeholder:text-muted-foreground focus:border-primary';

export function Input({ className, ...props }: ComponentProps<'input'>) {
    return <input className={cn(fieldClass, 'h-9', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
    return <textarea className={cn(fieldClass, 'min-h-20 py-2', className)} {...props} />;
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
