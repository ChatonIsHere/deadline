import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: ComponentProps<'div'>) {
    return <div className={cn('cut-frame p-5', className)} {...props} />;
}

export function CardTitle({ className, ...props }: ComponentProps<'h2'>) {
    return <h2 className={cn('mb-3 text-xs text-accent', className)} {...props} />;
}
