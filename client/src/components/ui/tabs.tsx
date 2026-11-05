import { Tabs as T } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const Tabs = T.Root;
export const TabsContent = T.Content;

export function TabsList({ className, ...props }: ComponentProps<typeof T.List>) {
    return <T.List className={cn('mb-5 flex gap-1 overflow-x-auto border-b border-border', className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof T.Trigger>) {
    return (
        <T.Trigger
            className={cn(
                '-mb-px cursor-pointer border-b-2 border-transparent px-3 py-2 font-display text-sm tracking-wider text-muted-foreground uppercase hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-primary',
                className,
            )}
            {...props}
        />
    );
}
