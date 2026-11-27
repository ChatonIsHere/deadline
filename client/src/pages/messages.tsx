import type { ChatKind, ChatSummary } from '@shared/schemas';
import { Bell, MessageSquarePlus } from 'lucide-react';
import { useState } from 'react';
import { Link, Outlet, useMatch } from 'react-router';
import { ChatIcon, chatPath, KIND_LABEL, NewChatDialog, UnreadBadge } from '@/components/chat';
import { Loading, Say } from '@/components/common';
import { Button } from '@/components/ui/button';
import { useChats, useUser } from '@/lib/api';
import { useMediaQuery } from '@/lib/media';
import { cn } from '@/lib/utils';

type Filter = 'all' | ChatKind | 'watching' | 'archived';

/** "14:02" today, "Mon" this week, "3 Nov" before that. */
export function shortTime(ms: number) {
    const d = new Date(ms);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (now.getTime() - ms < 6 * 86_400_000) return d.toLocaleDateString([], { weekday: 'short' });
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

/**
 * Every chat, newest first, and the open one beside the list on desktop. Phones show one or
 * the other. Admins also see gig chats they only oversee, under Watching.
 */
export function MessagesPage() {
    const me = useUser();
    const open = useMatch('/messages/:id');
    const desktop = useMediaQuery('(min-width: 1280px)');
    const [filter, setFilter] = useState<Filter>('all');
    const [newChat, setNewChat] = useState(false);
    const live = useChats();
    const archived = useChats(filter === 'archived');
    const chats = (filter === 'archived' ? archived.data?.filter((c) => c.archived) : live.data) ?? [];
    const shown = chats.filter((c) => {
        if (filter === 'archived') return true;
        if (filter === 'watching') return c.watching;
        if (c.watching) return false;
        return filter === 'all' || c.kind === filter;
    });
    const filters: { value: Filter; label: string }[] = [
        { value: 'all', label: 'All' },
        { value: 'direct', label: 'Direct' },
        { value: 'group', label: 'Groups' },
        { value: 'crew', label: 'Crews' },
        { value: 'gig', label: 'Gigs' },
        ...(me.isAdmin ? [{ value: 'watching' as const, label: 'Watching' }] : []),
        { value: 'archived', label: 'Archived' },
    ];

    const list = (
        <div className="flex min-h-0 flex-col gap-3">
            <div className="flex items-center gap-2">
                <h1 className="flex-1 text-2xl text-primary">Messages</h1>
                <Button size="sm" onClick={() => setNewChat(true)}>
                    <MessageSquarePlus className="size-4" /> New chat
                </Button>
            </div>
            <div className="flex flex-wrap gap-1">
                {filters.map((f) => (
                    <button
                        key={f.value}
                        type="button"
                        aria-pressed={filter === f.value}
                        onClick={() => setFilter(f.value)}
                        className={cn('cut cursor-pointer px-2 py-0.5 text-xs tracking-wider uppercase [--cut:4px]', filter === f.value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground')}
                    >
                        {f.label}
                    </button>
                ))}
            </div>
            {live.isPending ? (
                <Loading>opening channels...</Loading>
            ) : shown.length ? (
                <ul className="-mx-1 min-h-0 flex-1 space-y-1 overflow-y-auto px-1">
                    {shown.map((c) => (
                        <li key={c.id}>
                            <ChatRow chat={c} active={open?.params.id === c.id} />
                        </li>
                    ))}
                </ul>
            ) : (
                <Say>{filter === 'all' ? 'no chats yet. message someone from their page, or start one here.' : 'nothing here.'}</Say>
            )}
            <NewChatDialog open={newChat} onOpenChange={setNewChat} />
        </div>
    );

    if (!desktop) return open ? <Outlet /> : list;
    return (
        <div className="grid h-[calc(100dvh-7.5rem)] min-h-[28rem] grid-cols-[18rem_minmax(0,1fr)] gap-6 3xl:grid-cols-[22rem_minmax(0,1fr)]">
            {list}
            <div className="min-h-0 min-w-0">{open ? <Outlet /> : <Say className="pt-12 text-center">pick a chat, or start one.</Say>}</div>
        </div>
    );
}

function ChatRow({ chat, active }: { chat: ChatSummary; active: boolean }) {
    return (
        <Link
            to={chatPath(chat.id)}
            className={cn(
                'cut-frame flex items-center gap-3 p-2.5 [--cut:8px] hover:[--frame:var(--color-primary)]',
                active && '[--fill:color-mix(in_oklab,var(--color-primary)_15%,var(--color-card))] [--frame:var(--color-primary)]',
            )}
        >
            <ChatIcon chat={chat} className={cn('size-10 text-base [--cut:6px]', chat.archived && 'opacity-60 grayscale')} />
            <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                    <span className={cn('min-w-0 flex-1 truncate', chat.unread ? 'font-semibold text-foreground' : 'text-foreground/90')}>{chat.title}</span>
                    {chat.notify && <Bell className="size-3 shrink-0 text-accent" aria-label="Notifications on" />}
                    {chat.last && <span className="shrink-0 text-xs text-muted-foreground">{shortTime(chat.last.at)}</span>}
                </span>
                <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        {chat.last ? `${chat.last.handle}: ${chat.last.body}` : <span className="tracking-wider uppercase">{KIND_LABEL[chat.kind]} · no messages</span>}
                    </span>
                    <UnreadBadge count={chat.unread} />
                </span>
            </span>
        </Link>
    );
}
