import type { LiveTopic } from '@shared/schemas';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { io } from 'socket.io-client';

/**
 * Keeps the board live: the server says which parts changed (gigs, runners, crews...) and
 * those queries are fetched again. Pages showing them redraw what changed (see Live in
 * common.tsx). Forms aren't touched: they keep what you've typed until you save.
 */
export function useLiveUpdates(signedIn: boolean) {
    const queryClient = useQueryClient();
    useEffect(() => {
        if (!signedIn) return;
        const socket = io('/live', { withCredentials: true });
        socket.on('changed', ({ topics }: { topics: LiveTopic[] }) => {
            for (const topic of topics) void queryClient.invalidateQueries({ queryKey: [topic] });
        });
        // Catch up on anything missed while the connection was down
        socket.io.on('reconnect', () => void queryClient.invalidateQueries());
        return () => {
            socket.disconnect();
        };
    }, [signedIn, queryClient]);
}
