import { Injectable, Logger, Optional } from '@nestjs/common';
import webpush from 'web-push';
import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import type { PushSubscriptionInput } from '../shared/schemas';

export interface PushPayload {
    title: string;
    body: string;
    /** Where clicking it goes */
    url: string;
    /** Notifications with the same tag replace each other: one per chat */
    tag: string;
}

/** How a notification goes out. Tests pass their own. */
export type PushSender = (subscription: webpush.PushSubscription, payload: string) => Promise<unknown>;

/**
 * Web Push: real notifications on people's devices, even with Deadline closed. Each browser
 * that turns them on is a subscription; a person can have several. Off unless the VAPID keys
 * are set. Sending never throws: a notification is never worth failing a message over.
 */
@Injectable()
export class PushService {
    private readonly logger = new Logger(PushService.name);
    private readonly send: PushSender | null;

    constructor(
        private readonly prisma: PrismaService,
        @Optional() sender?: PushSender,
    ) {
        if (sender) this.send = sender;
        else if (config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY) {
            webpush.setVapidDetails(config.VAPID_SUBJECT ?? config.PUBLIC_URL, config.VAPID_PUBLIC_KEY, config.VAPID_PRIVATE_KEY);
            this.send = (subscription, payload) => webpush.sendNotification(subscription, payload, { TTL: 3600 });
        } else this.send = null;
    }

    /** The public key browsers subscribe with, or null when push is off. */
    publicKey(): string | null {
        return this.send ? (config.VAPID_PUBLIC_KEY ?? null) : null;
    }

    /** A browser turned notifications on. The same browser signing in as someone else moves to them. */
    async subscribe(userId: string, input: PushSubscriptionInput, userAgent?: string) {
        const data = { userId, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: userAgent?.slice(0, 300) ?? null };
        await this.prisma.pushSubscription.upsert({ where: { endpoint: input.endpoint }, create: { endpoint: input.endpoint, ...data }, update: data });
    }

    async unsubscribe(userId: string, endpoint: string) {
        await this.prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
    }

    /** Sends to every device of these people. Gone subscriptions (404, 410) are removed. */
    async notify(userIds: string[], payload: PushPayload) {
        if (!this.send || !userIds.length) return;
        const subscriptions = await this.prisma.pushSubscription.findMany({ where: { userId: { in: userIds } } });
        const body = JSON.stringify(payload);
        await Promise.all(
            subscriptions.map(async (s) => {
                try {
                    await this.send!({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body);
                } catch (err) {
                    const status = (err as { statusCode?: number }).statusCode;
                    if (status === 404 || status === 410) await this.prisma.pushSubscription.deleteMany({ where: { id: s.id } });
                    else this.logger.warn(`Couldn't send a push notification: ${(err as Error).message}`);
                }
            }),
        );
    }
}
