import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { GigPostService } from '../discord/gig-post.service';
import { plainVoice, type Said, voice } from '../discord/voice';
import {
    completeInput,
    type CompleteInput,
    gigDraftInput,
    type GigDraftInput,
    gigInput,
    type GigInput,
    joinInput,
    type Me,
    openSlotsInput,
    ratingInput,
    type RatingInput,
    runnerRefInput,
    scheduleInput,
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

    /** How many live gigs the signed in player is on, and the limit. */
    @Get('my-signups')
    mySignups(@CurrentUser() user: Me) {
        return this.gigs.mySignups(user.id);
    }

    /** By gig link or UUID. */
    @Get(':id')
    get(@CurrentUser() user: Me, @Param('id') ref: string) {
        return this.gigs.get(user, ref);
    }

    @Post()
    create(@CurrentUser() user: Me, @Body(new ZodPipe(gigInput)) body: GigInput) {
        return this.gigs.create(user, body);
    }

    /** Saves a new draft. Nothing is posted and nobody is told. */
    @Post('draft')
    createDraft(@CurrentUser() user: Me, @Body(new ZodPipe(gigDraftInput)) body: GigDraftInput) {
        return this.gigs.createDraft(user, body);
    }

    @Patch(':id/draft')
    updateDraft(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(gigDraftInput)) body: GigDraftInput) {
        return this.gigs.updateDraft(user, id, body);
    }

    /** A fixer's draft goes to the admins for approval. An admin's send posts it. */
    @Post(':id/send')
    send(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string) {
        return this.gigs.send(user, id);
    }

    /** Schedules a draft to post by itself (or stops that, with null). Admins only. */
    @Post(':id/schedule')
    schedule(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(scheduleInput)) body: { postAt: number | null }) {
        return this.gigs.schedule(user, id, body.postAt);
    }

    @Patch(':id')
    update(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(gigInput)) body: GigInput) {
        return this.gigs.update(user, id, body);
    }

    @Delete(':id')
    @HttpCode(204)
    delete(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string) {
        return this.gigs.delete(user, id);
    }

    @Post(':id/approve')
    approve(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string) {
        return this.gigs.approve(user, id, true);
    }

    @Post(':id/reject')
    reject(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string) {
        return this.gigs.approve(user, id, false);
    }

    @Post(':id/status')
    status(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(statusInput)) body: StatusInput) {
        return this.gigs.setStatus(user, id, body.status);
    }

    @Delete(':id/slots/:slotId/runner')
    kick(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string, @Param('slotId', ParseUUIDPipe) slotId: string) {
        return this.gigs.kick(user, id, slotId);
    }

    /** Admin puts a runner on the gig (a slot, or the reserves if it's full). */
    @Post(':id/runners')
    assign(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(runnerRefInput)) body: { runnerId: string }) {
        return this.gigs.assign(user, id, body.runnerId);
    }

    /** The GM wraps up the gig: summary and rewards. Runners get DMs with their payout. */
    @Post(':id/complete')
    complete(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(completeInput)) body: CompleteInput) {
        return this.debrief.complete(user, id, body);
    }

    /** A player rates the gig's fixer, from the web. The payout DM has the same menu. */
    @Post(':id/rating')
    async rate(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ratingInput)) body: RatingInput) {
        return { message: plain(await this.debrief.rate(user.id, id, body.stars, body.comment)) };
    }

    @Delete(':id/reserves/:userId')
    unreserve(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string, @Param('userId') userId: string) {
        return this.gigs.unreserve(user, id, userId);
    }

    // The signed in runner's own sign-up, same as the buttons on the Discord post

    /** `runnerId` is needed when the player has more than one runner. */
    @Post(':id/join')
    async join(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(joinInput)) body: { runnerId?: string }) {
        return { message: plain(await this.gigs.join(user.id, id, body.runnerId)) };
    }

    @Post(':id/confirm')
    async confirm(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string) {
        return { message: plain(await this.gigs.confirm(user.id, id)) };
    }

    @Post(':id/leave')
    async leave(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string) {
        await this.gigs.leave(user.id, id);
        return { message: plain(voice.left()) };
    }

    /** Lets any edgerunner take a crew's reserved slots. */
    @Post(':id/open-slots')
    openSlots(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(openSlotsInput)) body: { crewId: string }) {
        return this.gigs.openCrewSlots(user, id, body.crewId);
    }

    /** Sets (or clears, with null) the session time. Runners get asked to confirm. */
    @Post(':id/session')
    session(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(sessionInput)) body: { sessionAt: number | null }) {
        return this.gigs.setSession(user, id, body.sessionAt);
    }
}

/** Bot lines carry Discord markdown; the web's notifications want the plain text. */
const plain = (said: Said) => plainVoice(said);
