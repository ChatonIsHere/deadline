import { z } from 'zod';

// Shared by the server (request validation) and the client (forms).

export const GIG_STATUSES = ['pending', 'open', 'closed', 'completed', 'cancelled', 'rejected'] as const;
export type GigStatus = (typeof GIG_STATUSES)[number];

/** Statuses an admin can move a posted gig to. */
export const SET_STATUSES = ['open', 'closed', 'completed', 'cancelled'] as const;

export const MAX_SLOTS = 20;

const text = (max: number) => z.string().trim().min(1, 'Required').max(max);

export const gigInput = z.object({
    name: text(100),
    fixerName: text(60),
    location: text(100),
    type: z.string().trim().max(40).nullable(),
    pay: z.number({ error: 'Set the pay' }).int().min(1, 'Set the pay'),
    objective: text(2000),
    objectives: z
        .array(z.object({ text: text(150), bonus: z.number().int().min(1).nullable() }))
        .max(8),
    slots: z
        .array(z.object({ crewId: z.number().int().nullable(), count: z.number().int().min(1) }))
        .min(1, 'Add at least one slot')
        .refine((groups) => groups.reduce((sum, g) => sum + g.count, 0) <= MAX_SLOTS, `${MAX_SLOTS} slots max`),
});
export type GigInput = z.infer<typeof gigInput>;
export type SlotGroup = GigInput['slots'][number];

export const statusInput = z.object({ status: z.enum(SET_STATUSES) });
export type StatusInput = z.infer<typeof statusInput>;

export const crewInput = z.object({
    name: text(50),
    tagline: z.string().trim().max(120),
    ownerId: z.string().optional(),
});
export type CrewInput = z.infer<typeof crewInput>;

export const memberInput = z.object({ userId: z.string().min(1) });

// API responses

export interface Member {
    id: string;
    name: string;
    avatar: string | null;
}

export interface Me extends Member {
    isAdmin: boolean;
    isFixer: boolean;
    isEdgerunner: boolean;
}

export interface SlotView {
    id: number;
    crew: { id: number; name: string } | null;
    runner: Member | null;
}

export interface GigView {
    id: number;
    name: string;
    fixerName: string;
    location: string;
    type: string | null;
    pay: number;
    objective: string;
    objectives: { text: string; bonus: number | null }[];
    slots: SlotView[];
    status: GigStatus;
    createdBy: Member;
    threadUrl: string | null;
    createdAt: number;
}

export interface CrewView {
    id: number;
    name: string;
    tagline: string;
    owner: Member;
    members: Member[];
}
