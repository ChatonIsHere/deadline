import type { ChatEvent, ChatSummary } from '@shared/schemas';
import { MAX_CHAT_NAME, MAX_CHAT_RECIPIENTS } from '@shared/schemas';
import { MessageSquarePlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Icon } from '@/components/common';
import { RunnerAvatar } from '@/components/runner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input, Label } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { TagInput } from '@/components/ui/tag-input';
import { api, useChatCharacters, useChats, useCrew, useGig, useRunner, useUser } from '@/lib/api';
import { useLiveEvent } from '@/lib/live';
import { useMediaQuery } from '@/lib/media';
import { cn } from '@/lib/utils';

export const chatPath = (id: string) => `/messages/${id}`;

/** A chat's picture: the crew's logo, the gig's picture, the other character's in a direct chat, or a mark for groups. */
export function ChatIcon({ chat, className }: { chat: Pick<ChatSummary, 'kind' | 'title' | 'imageId'>; className?: string }) {
    if (!chat.imageId && (chat.kind === 'crew' || chat.kind === 'gig')) {
        return (
            <span className={cn('cut grid size-6 shrink-0 place-items-center bg-muted [--cut:4px]', className)}>
                <Icon name={chat.kind === 'crew' ? 'crew' : 'objective'} className="size-[60%]" />
            </span>
        );
    }
    if (chat.kind === 'group') {
        return <span className={cn('cut grid size-6 shrink-0 place-items-center bg-accent/20 font-display text-xs text-accent [--cut:4px]', className)}>#</span>;
    }
    return <RunnerAvatar runner={{ handle: chat.title, imageId: chat.imageId }} className={className} />;
}

/** What kind of chat it is, in a word. */
export const KIND_LABEL: Record<ChatSummary['kind'], string> = { direct: 'direct', group: 'group', crew: 'crew', gig: 'gig' };

/** Unread messages across your chats, for the Messages channel's badge. */
export function useUnreadCount(): number {
    const { data } = useChats();
    return data?.reduce((n, c) => n + c.unread, 0) ?? 0;
}

/** A count in a corner, for unread messages. */
export function UnreadBadge({ count, className }: { count: number; className?: string }) {
    if (!count) return null;
    return <span className={cn('cut inline-grid h-4 min-w-4 place-items-center bg-primary px-1 font-mono text-[10px] leading-none font-bold text-primary-foreground [--cut:3px]', className)}>{count > 99 ? '99+' : count}</span>;
}

/**
 * The chats that go with the page you're on: the crew's on a crew page, the gig's on a gig
 * page, and yours with a character on their page. `start` is that character, when you've
 * no chat with them yet.
 */
export function usePinnedChats(chats: ChatSummary[] | undefined): { pinned: ChatSummary[]; start: { id: string; handle: string; status: string; ownerId: string | null } | null } {
    const { pathname } = useLocation();
    const me = useUser();
    const [, kind, ref] = pathname.split('/');
    const record = !!ref && ref !== 'new';
    // Same queries as the pages, so these come from the cache
    const crew = useCrew(kind === 'crews' && record ? ref : undefined).data;
    const gig = useGig(kind === 'gigs' && record ? ref : undefined).data;
    const runner = useRunner((kind === 'runners' || kind === 'fixers') && record ? ref : undefined).data;
    if (!chats) return { pinned: [], start: null };
    if (crew) return { pinned: chats.filter((c) => c.crewId === crew.id), start: null };
    if (gig) return { pinned: chats.filter((c) => c.gigId === gig.id), start: null };
    if (runner) {
        const pinned = chats.filter((c) => c.kind === 'direct' && c.directWith === runner.id);
        const canStart = !pinned.length && runner.status === 'active' && runner.ownerId !== me.id;
        return { pinned, start: canStart ? { id: runner.id, handle: runner.ownerId ? runner.handle : runner.fixerName, status: runner.status, ownerId: runner.ownerId } : null };
    }
    return { pinned: [], start: null };
}

/** One chat in the tab: its picture, name and whether there's anything new. */
function TabRow({ chat }: { chat: ChatSummary }) {
    return (
        <NavLink
            to={chatPath(chat.id)}
            className={({ isActive }) =>
                cn(
                    'flex items-center gap-2 border-r-3 px-3 py-1.5 text-sm',
                    isActive ? 'border-primary bg-primary/20 text-primary' : 'border-transparent text-muted-foreground hover:border-primary/60 hover:bg-muted hover:text-foreground',
                    chat.unread > 0 && 'text-foreground',
                )
            }
        >
            <ChatIcon chat={chat} className={cn(chat.archived && 'opacity-60 grayscale')} />
            <span className="min-w-0 flex-1 truncate">{chat.title}</span>
            <UnreadBadge count={chat.unread} />
        </NavLink>
    );
}

/**
 * Desktop: your latest chats, in a tab on the right edge that mirrors the channel tab on the
 * left. As many as the window's height has room for (5 to 10), with the one for the page
 * you're on pinned at the top. The Messages page has them all.
 */
export function ChatTab() {
    const { pathname } = useLocation();
    const { data: chats } = useChats();
    const { pinned, start } = usePinnedChats(chats);
    const tall = useMediaQuery('(min-height: 1000px)');
    const medium = useMediaQuery('(min-height: 800px)');
    const [newChat, setNewChat] = useState<{ open: boolean; recipient?: string }>({ open: false });
    // The Messages page lists them already
    if (pathname.startsWith('/messages')) return null;

    const room = (tall ? 10 : medium ? 7 : 5) - pinned.length - (start ? 1 : 0);
    const pinnedIds = new Set(pinned.map((c) => c.id));
    const recent = (chats ?? []).filter((c) => !pinnedIds.has(c.id) && !c.watching).slice(0, Math.max(room, 0));

    return (
        <aside className="tab-frame-right fixed top-[calc(50%-1.5rem)] right-0 z-30 hidden w-52 -translate-y-1/2 flex-col pb-3 [--cut:16px] [--frame:color-mix(in_oklab,var(--color-primary)_40%,transparent)] xl:flex">
            <div className="flex h-12 items-center justify-between border-b-2 border-primary/40 pr-2 pl-4">
                <Link to="/messages" className="font-display text-sm font-bold tracking-[0.2em] text-primary hover:underline">
                    MESSAGES
                </Link>
                <Button variant="ghost" size="icon" aria-label="New chat" title="New chat" onClick={() => setNewChat({ open: true })}>
                    <MessageSquarePlus className="size-4" />
                </Button>
            </div>

            {(pinned.length > 0 || start) && (
                <>
                    <p className="px-4 pt-4 pb-1 text-xs tracking-widest text-muted-foreground">// PINNED</p>
                    <nav className="flex flex-col">
                        {pinned.map((c) => (
                            <TabRow key={c.id} chat={c} />
                        ))}
                        {start && (
                            <button
                                type="button"
                                onClick={() => setNewChat({ open: true, recipient: start.id })}
                                className="flex cursor-pointer items-center gap-2 border-r-3 border-transparent px-3 py-1.5 text-left text-sm text-accent hover:border-primary/60 hover:bg-muted"
                            >
                                <MessageSquarePlus className="size-4 shrink-0" />
                                <span className="min-w-0 flex-1 truncate">Message {start.handle}</span>
                            </button>
                        )}
                    </nav>
                </>
            )}

            <p className="px-4 pt-4 pb-1 text-xs tracking-widest text-muted-foreground">// RECENT</p>
            <nav className="flex flex-col">
                {recent.map((c) => (
                    <TabRow key={c.id} chat={c} />
                ))}
            </nav>
            {chats && !chats.length && <p className="px-4 py-1 text-xs text-muted-foreground">no chats yet.</p>}
            <Link to="/messages" className="mt-2 px-4 text-xs tracking-widest text-accent hover:underline">
                ALL →
            </Link>
            <NewChatDialog open={newChat.open} recipient={newChat.recipient} onOpenChange={(open) => setNewChat({ open })} />
        </aside>
    );
}

/** Opens (or starts) a chat and goes to it. */
function useStartChat(onDone?: () => void) {
    const navigate = useNavigate();
    const [busy, setBusy] = useState(false);
    const start = async (asRunnerId: string, recipientIds: string[], name: string | null = null) => {
        setBusy(true);
        try {
            const chat = await api<ChatSummary>('/api/chats', 'POST', { asRunnerId, recipientIds, name });
            onDone?.();
            navigate(chatPath(chat.id));
        } catch (err) {
            toast.error((err as Error).message);
        } finally {
            setBusy(false);
        }
    };
    return { start, busy };
}

/**
 * Starting a chat: who you're speaking as (picked for you when there's one), who to, and for a
 * group, a name. One person opens your direct chat with them; more makes a new group.
 */
export function NewChatDialog({ open, onOpenChange, recipient }: { open: boolean; onOpenChange: (open: boolean) => void; recipient?: string }) {
    const { data: mine } = useChatCharacters('as');
    const { data: others } = useChatCharacters('to');
    const [as, setAs] = useState('');
    const [to, setTo] = useState<string[]>([]);
    const [name, setName] = useState('');
    const { start, busy } = useStartChat(() => onOpenChange(false));

    useEffect(() => {
        if (!open) return;
        setTo(recipient ? [recipient] : []);
        setName('');
    }, [open, recipient]);
    const own = (mine ?? []).filter((r) => r.id !== recipient);
    // Your own character when you've one; admins pick when they've NPCs too
    useEffect(() => {
        if (!as || !own.some((r) => r.id === as)) setAs(own.length === 1 ? own[0].id : (own.filter((r) => !r.isNpc).length === 1 ? own.find((r) => !r.isNpc)!.id : ''));
    }, [own.map((r) => r.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps

    const options = (others ?? [])
        .filter((r) => r.id !== as)
        .map((r) => ({ key: r.id, label: r.handle, kind: r.isNpc ? 'npc' : 'runner', icon: <RunnerAvatar runner={r} className="size-4 [--cut:3px]" /> }));
    const group = to.length > 1;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogTitle>New chat</DialogTitle>
                <DialogDescription>one person opens your chat with them. more starts a group.</DialogDescription>
                {mine && !own.length ? (
                    <p className="mt-4 text-sm text-muted-foreground">you need an active character to chat as. make one on the Runners page.</p>
                ) : (
                    <form
                        className="mt-4 space-y-4"
                        onSubmit={(e) => {
                            e.preventDefault();
                            if (as && to.length) void start(as, to, group ? name.trim() || null : null);
                        }}
                    >
                        {own.length > 1 && (
                            <div>
                                <Label htmlFor="chat-as">Speaking as</Label>
                                <Select id="chat-as" value={as} onChange={setAs} placeholder="Pick a character" options={own.map((r) => ({ value: r.id, label: r.handle, hint: r.isNpc ? 'GM' : undefined }))} />
                            </div>
                        )}
                        <div>
                            <Label htmlFor="chat-to">To</Label>
                            <TagInput id="chat-to" options={options} value={to} onChange={(keys) => setTo(keys.slice(0, MAX_CHAT_RECIPIENTS))} placeholder="Start typing a handle" />
                        </div>
                        {group && (
                            <div>
                                <Label htmlFor="chat-name">Name (optional)</Label>
                                <Input id="chat-name" value={name} maxLength={MAX_CHAT_NAME} onChange={(e) => setName(e.target.value)} placeholder="The heist" />
                            </div>
                        )}
                        <div className="flex justify-end">
                            <Button type="submit" disabled={busy || !as || !to.length}>
                                {group ? 'Start group' : 'Open chat'}
                            </Button>
                        </div>
                    </form>
                )}
            </DialogContent>
        </Dialog>
    );
}

/**
 * "Message" on a character's page. With one character to speak as it goes straight to your
 * chat with them; otherwise it asks which.
 */
export function MessageButton({ runner }: { runner: { id: string; status: string; ownerId: string | null } }) {
    const me = useUser();
    const { data: mine } = useChatCharacters('as');
    const [open, setOpen] = useState(false);
    const { start, busy } = useStartChat();
    const own = (mine ?? []).filter((r) => r.id !== runner.id);
    if (runner.status !== 'active' || runner.ownerId === me.id || !own.length) return null;
    return (
        <>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => (own.length === 1 ? void start(own[0].id, [runner.id]) : setOpen(true))}>
                Message
            </Button>
            <NewChatDialog open={open} onOpenChange={setOpen} recipient={runner.id} />
        </>
    );
}

/** A button to a crew's or gig's chat, for those in it. Phones have no tab to pin it in. */
export function ChatLink({ crewId, gigId, label }: { crewId?: string; gigId?: string; label: string }) {
    const { data: chats } = useChats();
    const { data: archived } = useChats(true);
    const chat = [...(chats ?? []), ...(archived ?? [])].find((c) => (crewId && c.crewId === crewId) || (gigId && c.gigId === gigId));
    if (!chat || chat.watching) return null;
    return (
        <Button asChild variant="outline" size="sm">
            <Link to={chatPath(chat.id)}>
                {label}
                {chat.unread > 0 && <UnreadBadge count={chat.unread} />}
            </Link>
        </Button>
    );
}

/**
 * Phones and tablets have no chat tab, so a new message in a chat you're not looking at pops
 * up, with a button to open it. Desktop shows it in the tab instead.
 */
export function useChatToasts() {
    const me = useUser();
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const desktop = useMediaQuery('(min-width: 1280px)');
    const { data: chats } = useChats();
    useLiveEvent<ChatEvent>('chat', (event) => {
        const m = event.message;
        // New messages only, from someone else, in a chat you're not looking at
        if (!m || !event.title || m.editedAt || m.deleted || m.sentBy === me.id || desktop) return;
        if (pathname === chatPath(event.chatId)) return;
        if (chats?.find((c) => c.id === event.chatId)?.watching) return;
        toast(event.title, {
            description: `${m.runner.handle}: ${m.body || '📷 picture'}`.slice(0, 160),
            action: { label: 'Open', onClick: () => navigate(chatPath(event.chatId)) },
        });
    });
}
