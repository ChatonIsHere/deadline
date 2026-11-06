import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { GigPostService } from '../discord/gig-post.service';
import { plainVoice, voice } from '../discord/voice';
import {
    completeInput,
    type CompleteInput,
    gigInput,
    type GigInput,
    joinInput,
    type Me,
    openSlotsInput,
    ratingInput,
    type RatingInput,
    runnerRefInput,
    sessionInput,
    statusInput,
    type StatusInput,
} from '../shared/schemas';
import { ZodPipe } from '../zod.pipe';
import { DebriefService } from './debrief.service';
import { GigsService } from './gigs.service';

@Controller('api/gigs')
@UseGuards(AuthGuard)
export class GigsController {
    constructor(
        private readonly gigs: GigsService,
        private readonly posts: GigPostService,
        private readonly debrief: DebriefService,
    ) {}

    @Get()
    list(@CurrentUser() user: Me) {
        return this.gigs.list(user);
    }

    /** Suggested gig types, taken from the forum's tags. */
    @Get('types')
    types() {
        return this.posts.types().catch(() => []);
    }

    /** By UUID, gig link or numeric ID. */
    @Get(':id')
    get(@CurrentUser() user: Me, @Param('id') ref: string) {
        return this.gigs.get(user, ref);
    }

    @Post()
    create(@CurrentUser() user: Me, @Body(new ZodPipe(gigInput)) body: GigInput) {
        return this.gigs.create(user, body);
    }

    @Patch(':id')
    update(@CurrentUser() user: Me, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(gigInput)) body: GigInput) {
        return this.gigs.update(user, id, body);
    }

    @Delete(':id')
    @HttpCode(204)
    delete(@CurrentUser() user: Me, @Param('id', ParseIntPipe) id: number) {
        this.gigs.delete(user, id);
    }

    @Post(':id/approve')
    approve(@CurrentUser() user: Me, @Param('id', ParseIntPipe) id: number) {
        return this.gigs.approve(user, id, true);
    }

    @Post(':id/reject')
    reject(@CurrentUser() user: Me, @Param('id', ParseIntPipe) id: number) {
        return this.gigs.approve(user, id, false);
    }

    @Post(':id/status')
    status(@CurrentUser() user: Me, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(statusInput)) body: StatusInput) {
        return this.gigs.setStatus(user, id, body.status);
    }

    @Delete(':id/slots/:slotId/runner')
    kick(@CurrentUser() user: Me, @Param('id', ParseIntPipe) id: number, @Param('slotId', ParseIntPipe) slotId: number) {
        return this.gigs.kick(user, id, slotId);
    }

    /** Admin puts a runner on the gig (a slot, or the reserves if it's full). */
    @Post(':id/runners')
    assign(@CurrentUser() user: Me, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(runnerRefInput)) body: { runnerId: number }) {
        return this.gigs.assign(user, id, body.runnerId);
    }

    /** The GM wraps up the gig: summary and rewards. Runners get DMs with their payout. */
    @Post(':id/complete')
    complete(@CurrentUser() user: Me, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(completeInput)) body: CompleteInput) {
        return this.debrief.complete(user, id, body);
    }

    /** A player rates the gig's fixer, from the web. The payout DM has the same menu. */
    @Post(':id/rating')
    rate(@CurrentUser() user: Me, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(ratingInput)) body: RatingInput) {
        return { message: plain(this.debrief.rate(user.id, id, body.stars, body.comment)) };
    }

    @Delete(':id/reserves/:userId')
    unreserve(@CurrentUser() user: Me, @Param('id', ParseIntPipe) id: number, @Param('userId') userId: string) {
        return this.gigs.unreserve(user, id, userId);
    }

    // The signed in runner's own sign-up, same as the buttons on the Discord post

    /** `runnerId` is needed when the player has more than one runner. */
    @Post(':id/join')
    async join(@CurrentUser() user: Me, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(joinInput)) body: { runnerId?: number }) {
        return { message: plain(await this.gigs.join(user.id, id, body.runnerId)) };
    }

    @Post(':id/confirm')
    confirm(@CurrentUser() user: Me, @Param('id', ParseIntPipe) id: number) {
        return { message: plain(this.gigs.confirm(user.id, id)) };
    }

    @Post(':id/leave')
    leave(@CurrentUser() user: Me, @Param('id', ParseIntPipe) id: number) {
        this.gigs.leave(user.id, id);
        return { message: plain(voice.left()) };
    }

    /** Lets any edgerunner take a crew's reserved slots. */
    @Post(':id/open-slots')
    openSlots(@CurrentUser() user: Me, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(openSlotsInput)) body: { crewId: number }) {
        return this.gigs.openCrewSlots(user, id, body.crewId);
    }

    /** Sets (or clears, with null) the session time. Runners get asked to confirm. */
    @Post(':id/session')
    session(@CurrentUser() user: Me, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(sessionInput)) body: { sessionAt: number | null }) {
        return this.gigs.setSession(user, id, body.sessionAt);
    }
}

/**
 * Bot lines come as Discord code blocks; the web wants the text. These end up in the web's
 * notifications, which put "// DEADLINE:" on themselves, so it's taken off here.
 */
const plain = (said: string) => plainVoice(said).replace(/^\/\/ DEADLINE:\s*/, '');
