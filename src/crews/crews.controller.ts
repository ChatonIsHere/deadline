import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { crewInput, type CrewInput, frameInput, type FrameInput, hqInput, type HqInput, type Me, newCrewInput, type NewCrewInput, rankInput, runnerRefInput } from '../shared/schemas';
import { ZodPipe } from '../zod.pipe';
import { CrewsService } from './crews.service';

type RunnerRef = { runnerId: string };

@Controller('api/crews')
@UseGuards(AuthGuard)
export class CrewsController {
    constructor(private readonly crews: CrewsService) {}

    @Get()
    list() {
        return this.crews.list();
    }

    /** Invites waiting on the signed in player's runners. */
    @Get('invites')
    invites(@CurrentUser() user: Me) {
        return this.crews.invitesFor(user.id);
    }

    /** By link (name or handle) or UUID. */
    @Get(':id')
    async get(@Param('id') ref: string) {
        return this.crews.get(await this.crews.resolve(ref));
    }

    @Post()
    create(@CurrentUser() user: Me, @Body(new ZodPipe(newCrewInput)) body: NewCrewInput) {
        return this.crews.create(user, body);
    }

    @Patch(':id')
    update(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(crewInput)) body: CrewInput) {
        return this.crews.update(user, id, body);
    }

    @Delete(':id')
    @HttpCode(204)
    delete(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string) {
        return this.crews.delete(user, id);
    }

    /** Founders spend HQ IP. Admins can add or take it away too. */
    @Post(':id/hq')
    hq(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(hqInput)) body: HqInput) {
        return this.crews.hq(user, id, body);
    }

    /** The logo in another frame, as a new picture for the edit form to save. */
    @Post(':id/frame')
    frame(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(frameInput)) body: FrameInput) {
        return this.crews.frame(user, id, body.imageId, body.variant);
    }

    @Post(':id/members')
    addMember(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(runnerRefInput)) body: RunnerRef) {
        return this.crews.addMember(user, id, body.runnerId);
    }

    @Patch(':id/members/:runnerId')
    setRank(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string, @Param('runnerId', ParseUUIDPipe) runnerId: string, @Body(new ZodPipe(rankInput)) body: { rank: string }) {
        return this.crews.setRank(user, id, runnerId, body.rank);
    }

    @Delete(':id/members/:runnerId')
    removeMember(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string, @Param('runnerId', ParseUUIDPipe) runnerId: string) {
        return this.crews.removeMember(user, id, runnerId);
    }

    @Post(':id/allies')
    addAlly(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(runnerRefInput)) body: RunnerRef) {
        return this.crews.addAlly(user, id, body.runnerId);
    }

    @Delete(':id/allies/:runnerId')
    removeAlly(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string, @Param('runnerId', ParseUUIDPipe) runnerId: string) {
        return this.crews.removeAlly(user, id, runnerId);
    }

    @Post(':id/invites')
    invite(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(runnerRefInput)) body: RunnerRef) {
        return this.crews.invite(user, id, body.runnerId);
    }

    /** Founders cancel, the runner's player declines. */
    @Delete(':id/invites/:runnerId')
    @HttpCode(204)
    cancelInvite(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string, @Param('runnerId', ParseUUIDPipe) runnerId: string) {
        return this.crews.cancelInvite(user, id, runnerId);
    }

    @Post(':id/invites/:runnerId/accept')
    async accept(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string, @Param('runnerId', ParseUUIDPipe) runnerId: string) {
        await this.crews.accept(user.id, id, runnerId);
        return this.crews.get(id);
    }
}
