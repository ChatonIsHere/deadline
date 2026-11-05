import type { ComponentProps } from 'react';
import { Help } from '@/components/common';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: ComponentProps<'div'>) {
    return <div className={cn('cut-frame p-5', className)} {...props} />;
}

/** A card's heading. `help` adds a "?" with an explanation next to it. */
export function CardTitle({ className, help, ...props }: ComponentProps<'h2'> & { help?: string }) {
    const title = <h2 className={cn('mb-3 text-xs text-accent', help && 'mb-0', className)} {...props} />;
    if (!help) return title;
    return (
        <div className="mb-3 flex items-center gap-2">
            {title}
            <Help>{help}</Help>
        </div>
    );
}
