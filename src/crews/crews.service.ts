import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { DB, Db } from '../db/db';
import { crewMembers, crews, runners } from '../db/schema';
import { MembersService } from '../discord/members.service';
import { GigsService, toCard } from '../gigs/gigs.service';
import { canCreateCrew, canManageCrew } from '../shared/permissions';
import type { CrewInput, CrewView, Me } from '../shared/schemas';

/**
 * Crews are groups of runners. A player owns and runs each crew; admins can change any.
 * Crew slots on gigs go to the crew's runners.
 */
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
        const [crew] = this.db.insert(crews).values({ name: input.name, tagline: input.tagline, ownerId: user.id }).returning().all();
        return this.get(crew.id);
    }

    update(user: Me, id: number, input: CrewInput): CrewView {
        const crew = this.row(id);
        if (!canManageCrew(user, crew)) throw new ForbiddenException();
        this.checkName(input.name, id);

        const ownerId = user.isAdmin && input.ownerId ? input.ownerId : crew.ownerId;
        this.db.update(crews).set({ name: input.name, tagline: input.tagline, ownerId }).where(eq(crews.id, id)).run();
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

    /** The crew's owner (or an admin) adds a player's runner. */
    addMember(user: Me, id: number, runnerId: number): CrewView {
        const crew = this.row(id);
        if (!canManageCrew(user, crew)) throw new ForbiddenException();
        const runner = this.db.query.runners.findFirst({ where: eq(runners.id, runnerId) }).sync();
        if (!runner?.ownerId) throw new BadRequestException("Only players' runners can join a crew.");

        this.db.insert(crewMembers).values({ crewId: id, runnerId }).onConflictDoNothing().run();
        return this.get(id);
    }

    /** The crew's owner or an admin can remove any runner. A runner's own player can take them out. */
    removeMember(user: Me, id: number, runnerId: number): CrewView {
        const crew = this.row(id);
        const runner = this.db.query.runners.findFirst({ where: eq(runners.id, runnerId) }).sync();
        if (!canManageCrew(user, crew) && runner?.ownerId !== user.id) throw new ForbiddenException();

        this.db
            .delete(crewMembers)
            .where(and(eq(crewMembers.crewId, id), eq(crewMembers.runnerId, runnerId)))
            .run();
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

    private toView(crew: typeof crews.$inferSelect & { members: { runnerId: number }[] }): CrewView {
        const ids = crew.members.map((m) => m.runnerId);
        const members = ids.length ? this.db.query.runners.findMany({ where: inArray(runners.id, ids), orderBy: runners.handle }).sync() : [];
        return {
            id: crew.id,
            name: crew.name,
            tagline: crew.tagline,
            owner: this.members.member(crew.ownerId),
            members: members.map(toCard),
        };
    }
}
