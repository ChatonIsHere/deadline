import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const fieldClass =
    'cut w-full border-b-2 border-border bg-muted px-3 text-sm outline-none [--cut:8px] placeholder:text-muted-foreground focus:border-primary';

export function Input({ className, ...props }: ComponentProps<'input'>) {
    return <input className={cn(fieldClass, 'h-9', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
    return <textarea className={cn(fieldClass, 'min-h-28 py-2', className)} {...props} />;
}


export function Label({ className, ...props }: ComponentProps<'label'>) {
    return <label className={cn('mb-1 block font-display text-xs tracking-widest text-muted-foreground uppercase', className)} {...props} />;
}
