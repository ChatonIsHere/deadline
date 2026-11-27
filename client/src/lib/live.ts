import type { ChatEvent, ChatMessagePage, ChatMessageView, LiveTopic } from '@shared/schemas';
import { type InfiniteData, type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';

/** The one connection, shared by everything on the page. */
let socket: Socket | null = null;
/** The chat this page has open and in view, told to the server again on reconnect. */
let viewing: string | null = null;
const listeners = new Map<string, Set<(payload: unknown) => void>>();

/**
 * Puts a new or changed message into the chat's history, where it is or at the end. The
 * newest page is the first one (older pages load after it).
 */
export function upsertMessage(queryClient: QueryClient, message: ChatMessageView) {
    queryClient.setQueryData<InfiniteData<ChatMessagePage, string | null>>(['chat-messages', message.chatId], (data) => {
        if (!data) return data;
        let found = false;
        const pages = data.pages.map((page) => {
            if (!page.messages.some((m) => m.id === message.id)) return page;
            found = true;
            return { ...page, messages: page.messages.map((m) => (m.id === message.id ? message : m)) };
        });
        if (!found && pages.length) pages[0] = { ...pages[0], messages: [...pages[0].messages, message] };
        return { ...data, pages };
    });
}

/**
 * Keeps the board live: the server says which parts changed (gigs, runners, crews...) and
 * those queries are fetched again. Pages showing them redraw what changed (see Live in
 * common.tsx). Forms aren't touched: they keep what you've typed until you save.
 * Chats come with the message itself, which goes straight into the chat's history.
 */
export function useLiveUpdates(signedIn: boolean) {
    const queryClient = useQueryClient();
    useEffect(() => {
        if (!signedIn) return;
        const s = io('/live', { withCredentials: true });
        socket = s;
        s.on('changed', ({ topics }: { topics: LiveTopic[] }) => {
            for (const topic of topics) void queryClient.invalidateQueries({ queryKey: [topic] });
        });
        s.on('chat', (event: ChatEvent) => {
            if (event.message) upsertMessage(queryClient, event.message);
            void queryClient.invalidateQueries({ queryKey: ['chats'] });
        });
        for (const event of ['chat', 'typing']) s.on(event, (payload: unknown) => listeners.get(event)?.forEach((fn) => fn(payload)));
        s.on('connect', () => {
            if (viewing) s.emit('viewing', { chatId: viewing });
        });
        // Catch up on anything missed while the connection was down
        s.io.on('reconnect', () => void queryClient.invalidateQueries());
        return () => {
            s.disconnect();
            if (socket === s) socket = null;
        };
    }, [signedIn, queryClient]);
}

/** Runs `handler` for each of these events from the server, for as long as the component is up. */
export function useLiveEvent<T>(event: 'chat' | 'typing', handler: (payload: T) => void) {
    const latest = useRef(handler);
    latest.current = handler;
    useEffect(() => {
        const fn = (payload: unknown) => latest.current(payload as T);
        let set = listeners.get(event);
        if (!set) listeners.set(event, (set = new Set()));
        set.add(fn);
        return () => {
            set.delete(fn);
        };
    }, [event]);
}

/** Tells the server which chat is open and in view (null for none), so it isn't notified about. */
export function setViewing(chatId: string | null) {
    viewing = chatId;
    socket?.emit('viewing', { chatId });
}

export const viewingChat = () => viewing;

/** Someone's typing in a chat as one of their characters. */
export function sendTyping(chatId: string, runnerId: string) {
    socket?.emit('typing', { chatId, runnerId });
}
