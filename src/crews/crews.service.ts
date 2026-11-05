import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DB, Db } from '../db/db';
import { crewMembers, crews } from '../db/schema';
import { MembersService } from '../discord/members.service';
import { GigsService } from '../gigs/gigs.service';
import { canCreateCrew, canManageCrew } from '../shared/permissions';
import type { CrewInput, CrewView, Me } from '../shared/schemas';

@Injectable()
export class CrewsService {
    constructor(
        @Inject(DB) private readonly db: Db,
        private readonly members: MembersService,
        private readonly gigs: GigsService,
    ) {}

    list(): CrewView[] {
        return this.db.query.crews
            .findMany({ with: { members: true }, orderBy: crews.name })
            .sync()
            .map((c) => this.toView(c));
    }

    get(id: number): CrewView {
        return this.toView(this.row(id));
    }

    create(user: Me, input: CrewInput): CrewView {
        if (!canCreateCrew(user)) throw new ForbiddenException();
        this.checkName(input.name);

        const id = this.db.transaction((tx) => {
            const [crew] = tx.insert(crews).values({ name: input.name, tagline: input.tagline, ownerId: user.id }).returning().all();
            tx.insert(crewMembers).values({ crewId: crew.id, userId: user.id }).run();
            return crew.id;
        });
        return this.get(id);
    }

    update(user: Me, id: number, input: CrewInput): CrewView {
        const crew = this.row(id);
        if (!canManageCrew(user, crew)) throw new ForbiddenException();
        this.checkName(input.name, id);

        const ownerId = user.isAdmin && input.ownerId ? input.ownerId : crew.ownerId;
        this.db.transaction((tx) => {
            tx.update(crews).set({ name: input.name, tagline: input.tagline, ownerId }).where(eq(crews.id, id)).run();
            // The owner is always a member
            tx.insert(crewMembers).values({ crewId: id, userId: ownerId }).onConflictDoNothing().run();
        });

        if (input.name !== crew.name) this.gigs.refresh(this.gigs.gigsForCrew(id));
        return this.get(id);
    }

    delete(user: Me, id: number) {
        const crew = this.row(id);
        if (!canManageCrew(user, crew)) throw new ForbiddenException();

        const affected = this.gigs.gigsForCrew(id);
        // Their gig slots become open to anyone (ON DELETE SET NULL)
        this.db.delete(crews).where(eq(crews.id, id)).run();
        this.gigs.refresh(affected);
    }

    async addMember(user: Me, id: number, userId: string): Promise<CrewView> {
        const crew = this.row(id);
        if (!canManageCrew(user, crew)) throw new ForbiddenException();

        const member = await this.members.me(userId);
        if (!member?.isEdgerunner) throw new BadRequestException('Only edgerunners can join a crew.');

        this.db.insert(crewMembers).values({ crewId: id, userId }).onConflictDoNothing().run();
        return this.get(id);
    }

    /** Owners and admins can remove anyone but the owner. Members can remove themselves. */
    removeMember(user: Me, id: number, userId: string): CrewView {
        const crew = this.row(id);
        if (!canManageCrew(user, crew) && user.id !== userId) throw new ForbiddenException();
        if (userId === crew.ownerId) throw new BadRequestException('The owner stays. Hand the crew to someone else first.');

        this.db.delete(crewMembers).where(and(eq(crewMembers.crewId, id), eq(crewMembers.userId, userId))).run();
        return this.get(id);
    }

    private row(id: number) {
        const crew = this.db.query.crews.findFirst({ where: eq(crews.id, id), with: { members: true } }).sync();
        if (!crew) throw new NotFoundException('No such crew.');
        return crew;
    }

    private checkName(name: string, id?: number) {
        const taken = this.db.query.crews.findFirst({ where: eq(crews.name, name) }).sync();
        if (taken && taken.id !== id) throw new ConflictException('That name is taken.');
    }

    private toView(crew: typeof crews.$inferSelect & { members: { userId: string }[] }): CrewView {
        return {
            id: crew.id,
            name: crew.name,
            tagline: crew.tagline,
            owner: this.members.member(crew.ownerId),
            members: crew.members.map((m) => this.members.member(m.userId)).sort((a, b) => a.name.localeCompare(b.name)),
        };
    }
}
