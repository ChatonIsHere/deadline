import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { config } from '../config';
import { CrewsService } from '../crews/crews.service';
import { MembersService } from '../discord/members.service';
import { GigsService } from '../gigs/gigs.service';
import { stringList } from '../prisma/json';
import { PrismaService } from '../prisma/prisma.service';
import { RunnersService } from '../runners/runners.service';
import { webFile } from '../shared/images';
import { isUnposted } from '../shared/permissions';
import { StorageService } from '../storage/storage.service';
import { type LinkPreview, plainText } from './tags';

const DESCRIPTION = 'The gig board for our Cyberpunk RED campaign. Find work, bring your crew, get paid.';
const STATUS_LABEL = { open: 'Open', closed: 'Closed', completed: 'Completed', cancelled: 'Cancelled' } as Record<string, string>;
/** Discord shows a few lines of a description, so the brief only needs to set the scene. */
const BRIEF_LENGTH = 200;

type Found = Omit<LinkPreview, 'url' | 'image'> & { image: string | null };

/**
 * What links to the site show on Discord. Link previewers aren't signed in, so this only reads
 * what's listed here: never hidden objectives, downtime or who's playing, and nothing about gigs
 * that aren't on the board yet.
 */
@Injectable()
export class LinkPreviewService {
    private readonly logger = new Logger(LinkPreviewService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly storage: StorageService,
        private readonly members: MembersService,
        private readonly gigs: GigsService,
        private readonly runners: RunnersService,
        private readonly crews: CrewsService,
    ) {}

    /** The preview for a page. Anything that isn't a record's page gets the site's own. */
    async forPath(path: string): Promise<LinkPreview> {
        const url = `${config.PUBLIC_URL}${path}`;
        const site = { title: 'Deadline', description: DESCRIPTION, image: `${config.PUBLIC_URL}/logo.png`, url };
        const [, kind, ref] = /^\/(gigs|runners|fixers|crews)\/([^/]+)\/?$/.exec(path) ?? [];
        if (!kind) return site;
        try {
            const found = await this.find(kind, decodeURIComponent(ref));
            return found ? { ...found, image: found.image ?? site.image, url } : site;
        } catch (err) {
            // A bad link, or a lookup failing, must never stop the page itself loading
            if (!(err instanceof NotFoundException)) this.logger.warn(`No preview for ${path}: ${(err as Error).message}`);
            return site;
        }
    }

    private find(kind: string, ref: string): Promise<Found | null> {
        if (kind === 'gigs') return this.gig(ref);
        if (kind === 'crews') return this.crew(ref);
        return kind === 'fixers' ? this.fixer(ref) : this.runner(ref);
    }

    private picture(imageId: string | null): string | null {
        return imageId ? `${this.storage.base}${webFile(imageId)}` : null;
    }

    private async gig(ref: string): Promise<Found | null> {
        const gig = await this.prisma.gig.findUnique({
            where: { id: await this.gigs.resolve(ref) },
            select: { name: true, fixerName: true, location: true, type: true, brief: true, status: true, imageId: true, cardKey: true },
        });
        if (!gig || isUnposted(gig.status)) return null;
        const facts = [STATUS_LABEL[gig.status], gig.type, gig.fixerName, gig.location].filter(Boolean).join(' · ');
        return {
            title: gig.name,
            description: [facts, plainText(gig.brief, BRIEF_LENGTH)].filter(Boolean).join('\n\n'),
            // The card has the gig's name on it, in the shape Discord shows best
            image: gig.cardKey ? `${this.storage.base}${gig.cardKey}` : this.picture(gig.imageId),
            large: true,
        };
    }

    private async runner(ref: string): Promise<Found | null> {
        const r = await this.prisma.runner.findUnique({
            where: { id: await this.runners.resolve(ref) },
            select: { handle: true, role: true, extraRoles: true, tagline: true, status: true, imageId: true },
        });
        if (!r) return null;
        const gone = r.status === 'dead' ? 'Flatlined' : r.status === 'retired' ? 'Retired' : null;
        const roles = [r.role, ...stringList(r.extraRoles)].join(' · ');
        return { title: r.handle, description: [gone, roles, r.tagline].filter(Boolean).join('\n'), image: this.picture(r.imageId) };
    }

    private async fixer(ref: string): Promise<Found | null> {
        const r = await this.prisma.runner.findUnique({
            where: { id: await this.runners.resolve(ref) },
            select: { handle: true, fixerAlias: true, role: true, extraRoles: true, ownerId: true, tagline: true, specialties: true, imageId: true },
        });
        if (!r || !this.members.isFixerRunner({ role: r.role, extraRoles: stringList(r.extraRoles), ownerId: r.ownerId })) return null;
        return { title: r.fixerAlias || r.handle, description: ['Fixer', r.tagline, r.specialties].filter(Boolean).join('\n'), image: this.picture(r.imageId) };
    }

    private async crew(ref: string): Promise<Found | null> {
        const crew = await this.prisma.crew.findUnique({
            where: { id: await this.crews.resolve(ref) },
            select: { name: true, tagline: true, imageId: true, _count: { select: { members: true } } },
        });
        if (!crew) return null;
        const size = `Crew of ${crew._count.members}`;
        return { title: crew.name, description: [size, crew.tagline].filter(Boolean).join('\n'), image: this.picture(crew.imageId) };
    }
}
