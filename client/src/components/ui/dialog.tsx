import { Dialog as D } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({ className, children, ...props }: ComponentProps<typeof D.Content>) {
    return (
        <D.Portal>
            <D.Overlay className="fixed inset-0 z-40 bg-background/80" />
            <D.Content
                className={cn('cut-frame fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-1/2 p-6 [--frame:var(--color-primary)]', className)}
                {...props}
            >
                {children}
            </D.Content>
        </D.Portal>
    );
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof D.Title>) {
    return <D.Title className={cn('mb-2 font-display text-lg font-bold uppercase', className)} {...props} />;
}

export function DialogDescription({ className, ...props }: ComponentProps<typeof D.Description>) {
    return <D.Description className={cn('text-muted-foreground', className)} {...props} />;
}
