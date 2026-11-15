import { BadRequestException } from '@nestjs/common';
import { config } from './config';

// Ceilings and counts from the environment (config.ts). Messages are the board's voice.

const eb = (n: number) => `${n.toLocaleString('en-GB')} eb`;

/** Money in a gig or reward can't go past MAX_PAY. Everyone, admins too: it catches typos. */
export function checkEb(amount: number | null | undefined, what: string) {
    if (amount && amount > config.MAX_PAY) throw new BadRequestException(`${what} can be ${eb(config.MAX_PAY)} at most.`);
}

/** IP in a reward can't go past MAX_IP. */
export function checkIp(amount: number | null | undefined, what: string) {
    if (amount && amount > config.MAX_IP) throw new BadRequestException(`${what} can be ${config.MAX_IP.toLocaleString('en-GB')} at most.`);
}

/** Throws `message` when `count` has reached a limit that's on (above 0). */
export function checkCount(count: number, max: number, message: string) {
    if (max > 0 && count >= max) throw new BadRequestException(message);
}

/** "in 3 days", "in 25 minutes": how long until `at`. */
export function until(at: number, now = Date.now()): string {
    const minutes = Math.max(1, Math.ceil((at - now) / 60_000));
    if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
    const hours = Math.ceil(minutes / 60);
    if (hours < 48) return `in ${hours} hour${hours === 1 ? '' : 's'}`;
    const days = Math.ceil(hours / 24);
    return `in ${days} days`;
}

/**
 * Counts things in a sliding window, in memory. Fine for one process: it only slows people
 * down, and a restart forgets.
 */
export class Window {
    private readonly hits = new Map<string, number[]>();

    constructor(private readonly ms: number) {}

    /** How many times `key` was hit in the window, before this one. Records this one too. */
    hit(key: string, now = Date.now()): number {
        const recent = (this.hits.get(key) ?? []).filter((t) => t > now - this.ms);
        recent.push(now);
        this.hits.set(key, recent);
        if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (!v.some((t) => t > now - this.ms)) this.hits.delete(k);
        return recent.length - 1;
    }

    /** How many times `key` was hit in the window, without recording. */
    count(key: string, now = Date.now()): number {
        return (this.hits.get(key) ?? []).filter((t) => t > now - this.ms).length;
    }
}
