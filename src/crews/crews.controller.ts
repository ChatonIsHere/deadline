import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { crewInput, type CrewInput, type Me, newCrewInput, type NewCrewInput, rankInput, runnerRefInput } from '../shared/schemas';
import { ZodPipe } from '../zod.pipe';
import { CrewsService } from './crews.service';

type RunnerRef = { runnerId: number };

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

    /** By numeric or typed ID. */
    @Get(':id')
    get(@Param('id') ref: string) {
        return this.crews.get(this.crews.resolve(ref));
    }

    @Post()
    create(@CurrentUser() user: Me, @Body(new ZodPipe(newCrewInput)) body: NewCrewInput) {
        return this.crews.create(user, body);
    }

    @Patch(':id')
    update(@CurrentUser() user: Me, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(crewInput)) body: CrewInput) {
        return this.crews.update(user, id, body);
    }

    @Delete(':id')
    @HttpCode(204)
    delete(@CurrentUser() user: Me, @Param('id', ParseIntPipe) id: number) {
        this.crews.delete(user, id);
    }

    @Post(':id/members')
    addMember(@CurrentUser() user: Me, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(runnerRefInput)) body: RunnerRef) {
        return this.crews.addMember(user, id, body.runnerId);
    }

    @Patch(':id/members/:runnerId')
    setRank(@CurrentUser() user: Me, @Param('id', ParseIntPipe) id: number, @Param('runnerId', ParseIntPipe) runnerId: number, @Body(new ZodPipe(rankInput)) body: { rank: string }) {
        return this.crews.setRank(user, id, runnerId, body.rank);
    }

    @Delete(':id/members/:runnerId')
    removeMember(@CurrentUser() user: Me, @Param('id', ParseIntPipe) id: number, @Param('runnerId', ParseIntPipe) runnerId: number) {
        return this.crews.removeMember(user, id, runnerId);
    }

    @Post(':id/allies')
    addAlly(@CurrentUser() user: Me, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(runnerRefInput)) body: RunnerRef) {
        return this.crews.addAlly(user, id, body.runnerId);
    }

    @Delete(':id/allies/:runnerId')
    removeAlly(@CurrentUser() user: Me, @Param('id', ParseIntPipe) id: number, @Param('runnerId', ParseIntPipe) runnerId: number) {
        return this.crews.removeAlly(user, id, runnerId);
    }

    @Post(':id/invites')
    invite(@CurrentUser() user: Me, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(runnerRefInput)) body: RunnerRef) {
        return this.crews.invite(user, id, body.runnerId);
    }

    /** Founders cancel, the runner's player declines. */
    @Delete(':id/invites/:runnerId')
    @HttpCode(204)
    cancelInvite(@CurrentUser() user: Me, @Param('id', ParseIntPipe) id: number, @Param('runnerId', ParseIntPipe) runnerId: number) {
        this.crews.cancelInvite(user, id, runnerId);
    }

    @Post(':id/invites/:runnerId/accept')
    accept(@CurrentUser() user: Me, @Param('id', ParseIntPipe) id: number, @Param('runnerId', ParseIntPipe) runnerId: number) {
        this.crews.accept(user.id, id, runnerId);
        return this.crews.get(id);
    }
}
