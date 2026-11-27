import type { ChatMessageView, ChatRunner, ChatSummary, TypingEvent } from '@shared/schemas';
import { MAX_CHAT_IMAGES, MAX_CHAT_NAME, MAX_MESSAGE } from '@shared/schemas';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bell, BellOff, ImagePlus, Pencil, SendHorizontal, Trash2, Users, X } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { ChatIcon, KIND_LABEL } from '@/components/chat';
import { ConfirmButton, DiscordIcon, Loading, Say } from '@/components/common';
import { RunnerAvatar } from '@/components/runner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { CharCount, Input, Label, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { api, artPreviewUrl, artUrl, uploadImage, useChat, useChatCharacters, useChatMessages, useUser } from '@/lib/api';
import { sendTyping, setViewing, upsertMessage, useLiveEvent } from '@/lib/live';
import { useMediaQuery, useVisualViewport } from '@/lib/media';
import { enablePush, needsHomeScreen, pushState } from '@/lib/push';
import { cn } from '@/lib/utils';
import { shortTime } from '@/pages/messages';

/** Messages from the same character this close together sit under one name. */
const GROUP_MS = 5 * 60_000;
const TYPING_SEND_MS = 3000;
const TYPING_SHOW_MS = 5000;

const profilePath = (r: Pick<ChatRunner, 'isNpc' | 'slug' | 'fixerSlug'>) => (r.isNpc ? `/fixers/${r.fixerSlug ?? r.slug}` : `/runners/${r.slug}`);

/** Whether the page is on screen (not a background tab or a locked phone). */
function useVisible() {
    const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
    useEffect(() => {
        const update = () => setVisible(document.visibilityState === 'visible');
        document.addEventListener('visibilitychange', update);
        return () => document.removeEventListener('visibilitychange', update);
    }, []);
    return visible;
}

/**
 * One chat. On phones it fills the space between the prompt bar and the channel bar (and sits
 * above the keyboard when it's up); on desktop it's the right-hand side of the Messages page.
 */
export function ChatPage() {
    const { id } = useParams();
    const { data: chat, isError } = useChat(id);
    const desktop = useMediaQuery('(min-width: 1280px)');
    const box = useVisualViewport();
    const keyboard = box ? Math.max(0, window.innerHeight - box.height - box.offsetTop) : 0;

    const frame = (children: ReactNode) =>
        desktop ? (
            <div className="flex h-full min-h-0 flex-col">{children}</div>
        ) : (
            <div
                className="fixed inset-x-0 top-12 bottom-16 z-20 flex flex-col bg-background px-3 pt-3 md:px-6"
                // Above the keyboard, which covers the page without shrinking it
                style={keyboard > 80 ? { bottom: keyboard, top: 48 + (box?.offsetTop ?? 0) } : undefined}
            >
                {children}
            </div>
        );

    if (isError) return frame(<Say>no such chat.</Say>);
    if (!chat || !id) return frame(<Loading>opening channel...</Loading>);
    return frame(<ChatView key={chat.id} chat={chat} />);
}

function ChatView({ chat }: { chat: ChatSummary }) {
    const me = useUser();
    const visible = useVisible();
    const queryClient = useQueryClient();
    const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isPending } = useChatMessages(chat.id);
    const messages = useMemo(() => (data ? [...data.pages].reverse().flatMap((p) => p.messages) : []), [data]);
    const byId = useMemo(() => new Map(chat.members.map((m) => [m.id, m])), [chat.members]);
    const [typing, setTyping] = useState<Record<string, { handle: string; until: number }>>({});

    // This chat's open: no notifications for it, and it's read
    useEffect(() => {
        setViewing(visible ? chat.id : null);
        return () => setViewing(null);
    }, [chat.id, visible]);
    useEffect(() => {
        if (visible && chat.unread > 0) void api(`/api/chats/${chat.id}/read`, 'POST').catch(() => undefined);
    }, [chat.id, chat.unread, visible]);

    useLiveEvent<TypingEvent>('typing', (t) => {
        if (t.chatId !== chat.id) return;
        setTyping((now) => ({ ...now, [t.runnerId]: { handle: t.handle, until: Date.now() + TYPING_SHOW_MS } }));
    });
    // Whoever just said something has stopped typing
    const lastRunner = messages.at(-1)?.runner.id;
    useEffect(() => {
        if (lastRunner) setTyping(({ [lastRunner]: _, ...rest }) => rest);
    }, [lastRunner, messages.length]);
    useEffect(() => {
        if (!Object.keys(typing).length) return;
        const timer = setInterval(() => setTyping((now) => Object.fromEntries(Object.entries(now).filter(([, t]) => t.until > Date.now()))), 1000);
        return () => clearInterval(timer);
    }, [typing]);

    // Scrolling: start at the newest, follow new ones while you're at the bottom, and keep your place when older ones load in above
    const scroller = useRef<HTMLDivElement>(null);
    const atBottom = useRef(true);
    const before = useRef<number | null>(null);
    const firstId = messages[0]?.id;
    const lastId = messages.at(-1)?.id;
    useLayoutEffect(() => {
        const el = scroller.current;
        if (!el) return;
        if (before.current !== null) {
            el.scrollTop += el.scrollHeight - before.current;
            before.current = null;
        }
    }, [firstId]);
    useLayoutEffect(() => {
        const el = scroller.current;
        if (el && (atBottom.current || messages.at(-1)?.sentBy === me.id)) el.scrollTop = el.scrollHeight;
    }, [lastId]); // eslint-disable-line react-hooks/exhaustive-deps
    const loadOlder = () => {
        before.current = scroller.current?.scrollHeight ?? null;
        void fetchNextPage();
    };

    const typingNames = Object.entries(typing)
        .filter(([, t]) => t.until > Date.now())
        .map(([, t]) => t.handle);

    return (
        <>
            <ChatHeader chat={chat} />
            <div
                ref={scroller}
                onScroll={(e) => {
                    const el = e.currentTarget;
                    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                    if (el.scrollTop < 40 && hasNextPage && !isFetchingNextPage) loadOlder();
                }}
                className="min-h-0 flex-1 overflow-y-auto py-3 pr-1"
            >
                {hasNextPage && (
                    <div className="pb-3 text-center">
                        <Button variant="ghost" size="sm" disabled={isFetchingNextPage} onClick={loadOlder}>
                            {isFetchingNextPage ? 'Loading...' : 'Older messages'}
                        </Button>
                    </div>
                )}
                {isPending && <Loading>decrypting...</Loading>}
                {!isPending && !messages.length && <Say className="text-center">no messages yet. say something.</Say>}
                <ol className="space-y-0.5">
                    {messages.map((m, i) => {
                        const prev = messages[i - 1];
                        const grouped = !!prev && prev.runner.id === m.runner.id && m.createdAt - prev.createdAt < GROUP_MS;
                        const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
                        return (
                            <li key={m.id}>
                                {newDay && <DayLine at={m.createdAt} />}
                                <Message message={m} runner={byId.get(m.runner.id)} grouped={grouped && !newDay} chat={chat} onChange={(next) => upsertMessage(queryClient, next)} />
                            </li>
                        );
                    })}
                </ol>
            </div>
            <p className="h-5 truncate text-xs text-accent" aria-live="polite">
                {typingNames.length ? `${typingNames.join(', ')} ${typingNames.length === 1 ? 'is' : 'are'} typing...` : ''}
            </p>
            {chat.readOnly ? (
                <Say className="border-t-2 border-primary/40 py-3">{chat.archived ? 'this chat is archived. it stays here to read.' : chat.speakable.length ? 'nobody else here can answer.' : "read-only: none of your characters can speak here."}</Say>
            ) : chat.speakable.length ? (
                <Composer chat={chat} />
            ) : (
                <Say className="border-t-2 border-primary/40 py-3">you're watching this one. none of your characters are in it.</Say>
            )}
        </>
    );
}

function DayLine({ at }: { at: number }) {
    return (
        <div className="my-3 flex items-center gap-3 text-xs tracking-widest text-muted-foreground uppercase">
            <span className="h-px flex-1 bg-border" />
            {new Date(at).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: new Date(at).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })}
            <span className="h-px flex-1 bg-border" />
        </div>
    );
}

/** The chat's name and picture, who's in it, and its switches. */
function ChatHeader({ chat }: { chat: ChatSummary }) {
    const [people, setPeople] = useState(false);
    const where = chat.crewId ? `/crews/${chat.crewId}` : chat.gigId ? `/gigs/${chat.gigId}` : null;
    const handles = chat.members.map((m) => m.handle).join(', ');
    return (
        <div className="flex shrink-0 items-center gap-3 border-b-2 border-primary/40 pb-3">
            <Link to="/messages" className="text-muted-foreground hover:text-foreground xl:hidden" aria-label="All messages">
                <ArrowLeft className="size-5" />
            </Link>
            <ChatIcon chat={chat} className={cn('size-10 text-base [--cut:6px]', chat.archived && 'opacity-60 grayscale')} />
            <div className="min-w-0 flex-1">
                <h1 className="truncate font-display text-lg text-primary">{where ? <Link to={where} className="hover:underline">{chat.title}</Link> : chat.title}</h1>
                <p className="truncate text-xs text-muted-foreground">
                    <span className="tracking-wider uppercase">{KIND_LABEL[chat.kind]}</span>
                    {chat.archived && <Badge variant="muted" className="ml-2">archived</Badge>} · {handles}
                </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
                {!chat.archived && <NotifyToggle chat={chat} />}
                {chat.discordUrl && (
                    <Button asChild variant="ghost" size="icon" title="Open in Discord" aria-label="Open in Discord">
                        <a href={chat.discordUrl} target="_blank" rel="noreferrer">
                            <DiscordIcon />
                        </a>
                    </Button>
                )}
                <Button variant="ghost" size="icon" title="Who's here" aria-label="Who's here" onClick={() => setPeople(true)}>
                    <Users className="size-4" />
                </Button>
            </div>
            <PeopleDialog chat={chat} open={people} onOpenChange={setPeople} />
        </div>
    );
}

/** The bell: push notifications for this chat. The first time, the browser asks. */
function NotifyToggle({ chat }: { chat: ChatSummary }) {
    const queryClient = useQueryClient();
    const [busy, setBusy] = useState(false);
    const toggle = async () => {
        setBusy(true);
        try {
            if (!chat.notify) {
                let state = await pushState();
                if (state === 'ask') state = await enablePush();
                if (state !== 'on') {
                    toast.error(
                        state === 'off'
                            ? "push notifications aren't set up on this server."
                            : state === 'blocked'
                              ? 'notifications are blocked for this site. allow them in your browser settings.'
                              : needsHomeScreen()
                                ? 'add Deadline to your Home Screen (Share, then Add to Home Screen), then turn this on from there.'
                                : "this browser can't do push notifications.",
                    );
                    return;
                }
            }
            await api(`/api/chats/${chat.id}/notify`, 'PUT', { on: !chat.notify });
            await queryClient.invalidateQueries({ queryKey: ['chats'] });
            toast.success(chat.notify ? 'notifications off for this chat.' : "notifications on. you'll hear about new messages here.");
        } catch (err) {
            toast.error((err as Error).message);
        } finally {
            setBusy(false);
        }
    };
    return (
        <Button variant="ghost" size="icon" disabled={busy} onClick={() => void toggle()} title={chat.notify ? 'Notifications on' : 'Notify me'} aria-label={chat.notify ? 'Turn notifications off' : 'Turn notifications on'} aria-pressed={chat.notify}>
            {chat.notify ? <Bell className="size-4 text-accent" /> : <BellOff className="size-4" />}
        </Button>
    );
}

/** Who's in the chat. Groups can be renamed, added to and left from here. */
function PeopleDialog({ chat, open, onOpenChange }: { chat: ChatSummary; open: boolean; onOpenChange: (open: boolean) => void }) {
    const me = useUser();
    const queryClient = useQueryClient();
    const { data: others } = useChatCharacters('to');
    const [name, setName] = useState(chat.name ?? '');
    const [adding, setAdding] = useState('');
    useEffect(() => setName(chat.name ?? ''), [chat.name, open]);
    const isGroup = chat.kind === 'group';
    const canChange = isGroup && chat.speakable.length > 0;
    const refresh = () => queryClient.invalidateQueries({ queryKey: ['chats'] });
    const run = async (fn: () => Promise<unknown>, done: string) => {
        try {
            await fn();
            await refresh();
            toast.success(done);
        } catch (err) {
            toast.error((err as Error).message);
        }
    };
    const memberIds = new Set(chat.members.map((m) => m.id));
    const addable = (others ?? []).filter((r) => !memberIds.has(r.id));

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg">
                <DialogTitle>{chat.title}</DialogTitle>
                <DialogDescription>
                    {chat.kind === 'crew'
                        ? "the crew's chat. it follows the roster."
                        : chat.kind === 'gig'
                          ? "the gig's chat: its runners and fixer, from when the gig starts. it's archived when the gig is done."
                          : chat.kind === 'direct'
                            ? 'just the two of you.'
                            : 'a group chat. anyone in it can rename it or bring someone in.'}
                </DialogDescription>
                {canChange && (
                    <form
                        className="mt-4 flex items-end gap-2"
                        onSubmit={(e) => {
                            e.preventDefault();
                            void run(() => api(`/api/chats/${chat.id}`, 'PATCH', { name: name.trim() || null }), 'renamed.');
                        }}
                    >
                        <div className="flex-1">
                            <Label htmlFor="chat-rename">Name</Label>
                            <Input id="chat-rename" value={name} maxLength={MAX_CHAT_NAME} onChange={(e) => setName(e.target.value)} placeholder="No name: the handles" />
                        </div>
                        <Button type="submit" variant="outline" disabled={(name.trim() || null) === chat.name}>
                            Save
                        </Button>
                    </form>
                )}
                <ul className="mt-4 max-h-72 space-y-2 overflow-y-auto">
                    {chat.members.map((m) => {
                        const mine = m.ownerId === me.id || (me.isAdmin && m.isNpc);
                        return (
                            <li key={m.id} className="flex items-center gap-3">
                                <RunnerAvatar runner={m} className={cn('size-8 [--cut:5px]', m.status !== 'active' && 'opacity-60 grayscale')} />
                                <Link to={profilePath(m)} className="min-w-0 flex-1 truncate text-accent hover:underline" onClick={() => onOpenChange(false)}>
                                    {m.handle}
                                </Link>
                                {m.isNpc && <Badge variant="muted">npc</Badge>}
                                {m.status !== 'active' && <Badge variant="muted">{m.status}</Badge>}
                                {isGroup && mine && (
                                    <ConfirmButton
                                        size="sm"
                                        label="Leave"
                                        title={`Take ${m.handle} out?`}
                                        description="They won't see this chat any more. Someone in it can bring them back."
                                        onConfirm={() => void run(() => api(`/api/chats/${chat.id}/members/${m.id}`, 'DELETE'), `${m.handle} left.`)}
                                    />
                                )}
                            </li>
                        );
                    })}
                </ul>
                {canChange && (
                    <div className="mt-4 flex items-end gap-2">
                        <div className="flex-1">
                            <Label htmlFor="chat-add">Bring someone in</Label>
                            <Select id="chat-add" value={adding} onChange={setAdding} placeholder="Pick a character" options={addable.map((r) => ({ value: r.id, label: r.handle, hint: r.isNpc ? 'npc' : undefined }))} />
                        </div>
                        <Button
                            variant="outline"
                            disabled={!adding}
                            onClick={() =>
                                void run(async () => {
                                    await api(`/api/chats/${chat.id}/members`, 'POST', { runnerId: adding });
                                    setAdding('');
                                }, 'added.')
                            }
                        >
                            Add
                        </Button>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

/** One message, under its character's name and picture unless it follows on from theirs. */
function Message({ message: m, runner, grouped, chat, onChange }: { message: ChatMessageView; runner?: ChatRunner; grouped: boolean; chat: ChatSummary; onChange: (m: ChatMessageView) => void }) {
    const me = useUser();
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(m.body);
    const mine = m.sentBy === me.id;
    const canEdit = mine && !m.deleted && !chat.readOnly;
    const canDelete = (mine || me.isAdmin) && !m.deleted;
    const who = runner ?? { ...m.runner, fixerSlug: null };

    const save = async () => {
        try {
            onChange(await api<ChatMessageView>(`/api/chats/${chat.id}/messages/${m.id}`, 'PATCH', { body: draft.trim() }));
            setEditing(false);
        } catch (err) {
            toast.error((err as Error).message);
        }
    };
    const remove = async () => {
        try {
            onChange(await api<ChatMessageView>(`/api/chats/${chat.id}/messages/${m.id}`, 'DELETE'));
        } catch (err) {
            toast.error((err as Error).message);
        }
    };

    return (
        <div className={cn('group relative flex gap-3 px-1 hover:bg-muted/40', grouped ? 'py-0.5' : 'mt-2 pt-1.5 pb-0.5')}>
            <div className="w-9 shrink-0">
                {!grouped && (
                    <Link to={profilePath(who)}>
                        <RunnerAvatar runner={m.runner} className="size-9 [--cut:6px]" />
                    </Link>
                )}
            </div>
            <div className="min-w-0 flex-1">
                {!grouped && (
                    <p className="flex items-baseline gap-2">
                        <Link to={profilePath(who)} className={cn('font-display font-semibold hover:underline', mine ? 'text-primary' : 'text-accent')}>
                            {m.runner.handle}
                        </Link>
                        <span className="text-xs text-muted-foreground" title={new Date(m.createdAt).toLocaleString()}>
                            {shortTime(m.createdAt)}
                        </span>
                    </p>
                )}
                {editing ? (
                    <div className="space-y-2 py-1">
                        <Textarea
                            value={draft}
                            maxLength={MAX_MESSAGE}
                            autoFocus
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    if (draft.trim()) void save();
                                } else if (e.key === 'Escape') setEditing(false);
                            }}
                            className="min-h-16"
                        />
                        <div className="flex gap-2">
                            <Button size="sm" disabled={!draft.trim()} onClick={() => void save()}>
                                Save
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                                Cancel
                            </Button>
                        </div>
                    </div>
                ) : m.deleted ? (
                    <p className="text-sm text-muted-foreground italic">message deleted</p>
                ) : (
                    <>
                        {m.body && (
                            <p className="text-sm break-words whitespace-pre-wrap">
                                {m.body}
                                {m.editedAt && <span className="ml-1 text-[10px] tracking-wider text-muted-foreground uppercase">(edited)</span>}
                            </p>
                        )}
                        {m.imageIds.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-2">
                                {m.imageIds.map((id) => (
                                    <a key={id} href={artUrl(id)} target="_blank" rel="noreferrer">
                                        <img src={artPreviewUrl(id)} alt="" loading="lazy" className="cut max-h-64 max-w-[min(20rem,100%)] object-contain [--cut:8px]" />
                                    </a>
                                ))}
                            </div>
                        )}
                    </>
                )}
            </div>
            {!editing && (canEdit || canDelete) && (
                <div className="absolute top-0 right-1 hidden gap-1 group-focus-within:flex group-hover:flex">
                    {canEdit && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            aria-label="Edit"
                            title="Edit"
                            onClick={() => {
                                setDraft(m.body);
                                setEditing(true);
                            }}
                        >
                            <Pencil className="size-3.5" />
                        </Button>
                    )}
                    {canDelete && (
                        <ConfirmButton
                            size="icon"
                            className="size-7"
                            label={<Trash2 className="size-3.5" />}
                            title="Delete this message?"
                            description="It goes here and on Discord. Everyone sees that a message was deleted."
                            onConfirm={() => void remove()}
                        />
                    )}
                </div>
            )}
        </div>
    );
}

/**
 * Where you type. Enter sends, Shift+Enter is a new line. With more than one character you
 * can speak as here, the one speaking is picked under the box (and remembered for this chat).
 */
function Composer({ chat }: { chat: ChatSummary }) {
    const me = useUser();
    const queryClient = useQueryClient();
    const storageKey = `chat-as:${chat.id}`;
    const options = chat.speakable.map((id) => chat.members.find((m) => m.id === id)).filter((m): m is ChatRunner => !!m);
    const [as, setAs] = useState(() => {
        const saved = localStorage.getItem(storageKey);
        return saved && chat.speakable.includes(saved) ? saved : (chat.speakable[0] ?? '');
    });
    const speaking = chat.speakable.includes(as) ? as : (chat.speakable[0] ?? '');
    const [body, setBody] = useState('');
    const [images, setImages] = useState<{ id: string; preview: string }[]>([]);
    const [uploading, setUploading] = useState(0);
    const [sending, setSending] = useState(false);
    const lastTyping = useRef(0);
    const file = useRef<HTMLInputElement>(null);
    const box = useRef<HTMLTextAreaElement>(null);

    // The box grows with what's typed, up to a point
    useLayoutEffect(() => {
        const el = box.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }, [body]);

    const pick = (runnerId: string) => {
        setAs(runnerId);
        localStorage.setItem(storageKey, runnerId);
    };

    const attach = async (files: FileList | null) => {
        const list = [...(files ?? [])].slice(0, MAX_CHAT_IMAGES - images.length);
        for (const f of list) {
            setUploading((n) => n + 1);
            try {
                const id = await uploadImage(f, { kind: 'art' });
                setImages((now) => [...now, { id, preview: URL.createObjectURL(f) }]);
            } catch (err) {
                toast.error((err as Error).message);
            } finally {
                setUploading((n) => n - 1);
            }
        }
        if (file.current) file.current.value = '';
    };

    const send = async () => {
        const text = body.trim();
        if ((!text && !images.length) || sending || uploading || !speaking) return;
        setSending(true);
        try {
            const message = await api<ChatMessageView>(`/api/chats/${chat.id}/messages`, 'POST', { asRunnerId: speaking, body: text, imageIds: images.map((i) => i.id) });
            upsertMessage(queryClient, message);
            setBody('');
            setImages([]);
            void queryClient.invalidateQueries({ queryKey: ['chats'] });
        } catch (err) {
            toast.error((err as Error).message);
        } finally {
            setSending(false);
            box.current?.focus();
        }
    };

    const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void send();
        }
    };

    return (
        <div className="shrink-0 space-y-2 border-t-2 border-primary/40 pt-3 pb-3">
            {(images.length > 0 || uploading > 0) && (
                <div className="flex flex-wrap gap-2">
                    {images.map((img) => (
                        <span key={img.id} className="relative">
                            <img src={img.preview} alt="" className="cut size-16 object-cover [--cut:6px]" />
                            <button
                                type="button"
                                aria-label="Remove picture"
                                onClick={() => setImages((now) => now.filter((i) => i.id !== img.id))}
                                className="absolute -top-1 -right-1 grid size-5 cursor-pointer place-items-center bg-destructive text-destructive-foreground"
                            >
                                <X className="size-3" />
                            </button>
                        </span>
                    ))}
                    {uploading > 0 && <span className="cut grid size-16 place-items-center bg-muted text-xs text-muted-foreground [--cut:6px]">uploading</span>}
                </div>
            )}
            <div className="flex items-end gap-2">
                <Button variant="ghost" size="icon" className="mb-0.5 shrink-0" aria-label="Attach pictures" title="Attach pictures" disabled={images.length + uploading >= MAX_CHAT_IMAGES} onClick={() => file.current?.click()}>
                    <ImagePlus className="size-4" />
                </Button>
                <input ref={file} type="file" accept="image/*" multiple hidden onChange={(e) => void attach(e.target.files)} />
                <textarea
                    ref={box}
                    rows={1}
                    value={body}
                    maxLength={MAX_MESSAGE}
                    placeholder={`Message as ${options.find((o) => o.id === speaking)?.handle ?? '...'}`}
                    onChange={(e) => {
                        setBody(e.target.value);
                        if (Date.now() - lastTyping.current > TYPING_SEND_MS && e.target.value) {
                            lastTyping.current = Date.now();
                            sendTyping(chat.id, speaking);
                        }
                    }}
                    onKeyDown={onKeyDown}
                    className="cut max-h-50 min-h-9 w-full resize-none border-b-3 border-input bg-muted px-3 py-2 text-sm outline-none [--cut:8px] placeholder:text-muted-foreground focus:border-primary"
                />
                <Button size="icon" className="mb-0.5 shrink-0" aria-label="Send" title="Send (Enter)" disabled={sending || uploading > 0 || (!body.trim() && !images.length)} onClick={() => void send()}>
                    <SendHorizontal className="size-4" />
                </Button>
            </div>
            {(options.length > 1 || body.length > MAX_MESSAGE * 0.9) && (
                <div className="flex items-center gap-2">
                    {options.length > 1 && (
                        <>
                            <span className="text-xs tracking-widest text-muted-foreground uppercase">As</span>
                            <Select
                                value={speaking}
                                onChange={pick}
                                className="h-7 w-auto min-w-40 text-xs"
                                options={options.map((o) => ({ value: o.id, label: o.handle, hint: o.ownerId === me.id ? undefined : 'GM' }))}
                            />
                        </>
                    )}
                    <CharCount length={body.length} max={MAX_MESSAGE} className="ml-auto" />
                </div>
            )}
        </div>
    );
}
