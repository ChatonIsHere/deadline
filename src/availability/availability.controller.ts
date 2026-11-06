import { Body, Controller, ForbiddenException, Get, HttpCode, Put, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { hourList, PrefsService } from '../auth/prefs.service';
import { MembersService } from '../discord/members.service';
import { PrismaService } from '../prisma/prisma.service';
import { availabilityInput, type Me, type PlayerAvailability } from '../shared/schemas';
import { ZodPipe } from '../zod.pipe';

/** When people can usually play. Everyone sets their own; admins see everyone's. */
@Controller('api/availability')
@UseGuards(AuthGuard)
export class AvailabilityController {
    constructor(
        private readonly prefs: PrefsService,
        private readonly members: MembersService,
        private readonly prisma: PrismaService,
    ) {}

    @Get('mine')
    mine(@CurrentUser() user: Me) {
        return this.prefs.availability(user.id);
    }

    @Put('mine')
    @HttpCode(204)
    async set(@CurrentUser() user: Me, @Body(new ZodPipe(availabilityInput)) { hours }: { hours: number[] }) {
        await this.prefs.setAvailability(user.id, hours);
    }

    /** Everyone who can sign in, with their week and crews, for the heatmap. Admins only. */
    @Get()
    async all(@CurrentUser() user: Me): Promise<PlayerAvailability[]> {
        if (!user.isAdmin) throw new ForbiddenException();
        const players = this.members.players();
        const ids = players.map((p) => p.id);
        const [rows, memberships] = await Promise.all([
            this.prisma.userPrefs.findMany({ where: { userId: { in: ids } }, select: { userId: true, timezone: true, availability: true } }),
            this.prisma.crewMember.findMany({ where: { runner: { ownerId: { in: ids } } }, select: { crewId: true, runner: { select: { ownerId: true } } } }),
        ]);
        const byUser = new Map(rows.map((r) => [r.userId, r]));
        return players.map((member) => {
            const row = byUser.get(member.id);
            const crewIds = [...new Set(memberships.filter((m) => m.runner.ownerId === member.id).map((m) => m.crewId))];
            return { member, timezone: row?.timezone ?? null, hours: row ? hourList(row.availability) : [], crewIds };
        });
    }
}
