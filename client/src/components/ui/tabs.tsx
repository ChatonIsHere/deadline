import { Tabs as T } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const Tabs = T.Root;
export const TabsContent = T.Content;

export function TabsList({ className, ...props }: ComponentProps<typeof T.List>) {
    return <T.List className={cn('mb-5 flex gap-1 overflow-x-auto overflow-y-hidden shadow-[inset_0_-2px_0_var(--color-border)] [scrollbar-width:none]', className)} {...props} />;
}

/** The focus outline sits inside the tab, because the list scrolls and would clip it to a stray line. */
export function TabsTrigger({ className, ...props }: ComponentProps<typeof T.Trigger>) {
    return (
        <T.Trigger
            className={cn(
                'shrink-0 cursor-pointer border-b-3 whitespace-nowrap border-transparent px-3 py-2 font-display text-sm tracking-wider text-muted-foreground uppercase hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-primary focus-visible:-outline-offset-2',
                className,
            )}
            {...props}
        />
    );
}
