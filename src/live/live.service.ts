import { Injectable } from '@nestjs/common';
import type { LiveTopic } from '../shared/schemas';

/** Which parts of the board show each table, so a write refreshes the right pages. Chats aren't here: they're private, and go to their own people (toUsers). */
const MODEL_TOPICS: Record<string, LiveTopic[]> = {
    Gig: ['gigs', 'runners', 'fixers', 'crews'],
    GigObjective: ['gigs'],
    GigSlot: ['gigs', 'runners', 'crews'],
    GigReserve: ['gigs', 'runners'],
    GigReward: ['gigs', 'runners'],
    FixerRating: ['gigs', 'fixers', 'runners'],
    Runner: ['runners', 'fixers', 'gigs', 'crews'],
    DowntimeEntry: ['runners'],
    RunnerPhoto: ['runners', 'fixers'],
    Crew: ['crews', 'runners', 'gigs'],
    CrewMember: ['crews', 'runners'],
    CrewAlly: ['crews'],
    CrewInvite: ['crews'],
    CrewHqEntry: ['crews', 'gigs'],
    Image: ['library'],
    Region: ['library'],
    Settings: ['settings'],
    UserPrefs: ['availability'],
};

export const SIGNED_IN = 'signed-in';
export const userRoom = (userId: string) => `user:${userId}`;

/** Where changes go: the live gateway's namespace, with a room for everyone signed in and one per person. */
export interface Rooms {
    to(room: string | string[]): { emit(event: string, payload: unknown): void };
}

/**
 * Tells open pages what changed, so they fetch it again. Every database write lands here (see
 * PrismaService), whether it came from the web, a Discord button or a scheduled job. Only the
 * topics go out, never the data: each browser refetches with its own permissions, so nobody
 * sees a pending gig they shouldn't. Writes are gathered for a moment and sent together.
 *
 * Chats are the exception: their events (with the message itself) go only to the people in
 * them, through each person's own room.
 */
@Injectable()
export class LiveService {
    private rooms: Rooms | null = null;
    private readonly pending = new Set<LiveTopic>();
    private timer: NodeJS.Timeout | null = null;
    /** The chat each open socket is showing, so nobody is notified about a chat in front of them. */
    private readonly viewing = new Map<string, { userId: string; chatId: string }>();

    attach(rooms: Rooms) {
        this.rooms = rooms;
    }

    /** A table was written to. */
    changed(model: string) {
        const topics = MODEL_TOPICS[model];
        if (!topics) return;
        for (const t of topics) this.pending.add(t);
        if (!this.timer) {
            this.timer = setTimeout(() => this.flush(), 150);
            this.timer.unref();
        }
    }

    /** Sends an event to these people's open pages, and nobody else's. */
    toUsers(userIds: Iterable<string>, event: string, payload: unknown) {
        const rooms = [...new Set(userIds)].map(userRoom);
        if (rooms.length) this.rooms?.to(rooms).emit(event, payload);
    }

    /** A socket is showing a chat now (or nothing, with null). */
    setViewing(socketId: string, userId: string, chatId: string | null) {
        if (chatId) this.viewing.set(socketId, { userId, chatId });
        else this.viewing.delete(socketId);
    }

    /** Whether one of this person's open pages is showing the chat. */
    isViewing(userId: string, chatId: string): boolean {
        for (const v of this.viewing.values()) if (v.userId === userId && v.chatId === chatId) return true;
        return false;
    }

    private flush() {
        this.timer = null;
        const topics = [...this.pending];
        this.pending.clear();
        if (topics.length) this.rooms?.to(SIGNED_IN).emit('changed', { topics });
    }
}
