import { Injectable } from '@nestjs/common';
import type { LiveTopic } from '../shared/schemas';

/** Which parts of the board show each table, so a write refreshes the right pages. */
const MODEL_TOPICS: Record<string, LiveTopic[]> = {
    Gig: ['gigs', 'runners', 'fixers', 'crews'],
    GigObjective: ['gigs'],
    GigSlot: ['gigs', 'runners', 'crews'],
    GigReserve: ['gigs', 'runners'],
    GigReward: ['gigs', 'runners'],
    FixerRating: ['gigs', 'fixers', 'runners'],
    Runner: ['runners', 'fixers', 'gigs', 'crews'],
    Crew: ['crews', 'runners', 'gigs'],
    CrewMember: ['crews', 'runners'],
    CrewAlly: ['crews'],
    CrewInvite: ['crews'],
    Image: ['library'],
    Region: ['library'],
    Settings: ['settings'],
    UserPrefs: ['availability'],
};

/** Where changes go: the live gateway's room of signed in browsers. */
interface Room {
    emit(event: 'changed', payload: { topics: LiveTopic[] }): void;
}

/**
 * Tells open pages what changed, so they fetch it again. Every database write lands here (see
 * PrismaService), whether it came from the web, a Discord button or a scheduled job. Only the
 * topics go out, never the data: each browser refetches with its own permissions, so nobody
 * sees a pending gig they shouldn't. Writes are gathered for a moment and sent together.
 */
@Injectable()
export class LiveService {
    private room: Room | null = null;
    private readonly pending = new Set<LiveTopic>();
    private timer: NodeJS.Timeout | null = null;

    attach(room: Room) {
        this.room = room;
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

    private flush() {
        this.timer = null;
        const topics = [...this.pending];
        this.pending.clear();
        if (topics.length) this.room?.emit('changed', { topics });
    }
}
