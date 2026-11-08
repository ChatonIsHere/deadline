import { Tabs as T } from 'radix-ui';
import { type ComponentProps, type ReactNode, useState } from 'react';
import { useLocation } from 'react-router';
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

/** The tab each page had open, so going to a card and back returns to it. */
const openTabs = new Map<string, string>();

export interface PageTab {
    key: string;
    label: string;
    count: number;
    content: ReactNode;
}

/**
 * A page's tabs. Empty tabs are hidden, and with only one left there's no tab bar, just its
 * content. With none, `empty` shows. If the open tab empties (say, a live update), the first
 * one left opens.
 */
export function PageTabs({ tabs, empty }: { tabs: PageTab[]; empty: ReactNode }) {
    const shown = tabs.filter((t) => t.count > 0);
    const { pathname } = useLocation();
    const [picked, setPicked] = useState(openTabs.get(pathname) ?? shown[0]?.key ?? '');
    const pick = (key: string) => {
        openTabs.set(pathname, key);
        setPicked(key);
    };
    if (!shown.length) return <>{empty}</>;
    if (shown.length === 1) return <>{shown[0].content}</>;
    const value = shown.some((t) => t.key === picked) ? picked : shown[0].key;
    return (
        <Tabs value={value} onValueChange={pick} className="xl:flex xl:flex-1 xl:flex-col">
            <TabsList>
                {shown.map((t) => (
                    <TabsTrigger key={t.key} value={t.key}>
                        {t.label} <span className="text-xs opacity-60">{t.count}</span>
                    </TabsTrigger>
                ))}
            </TabsList>
            {shown.map((t) => (
                <TabsContent key={t.key} value={t.key} className="xl:data-[state=active]:flex xl:data-[state=active]:flex-1 xl:data-[state=active]:flex-col">
                    {t.content}
                </TabsContent>
            ))}
        </Tabs>
    );
}
