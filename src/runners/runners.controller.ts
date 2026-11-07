import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { MembersService } from '../discord/members.service';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { type Me, retireInput, type RetireInput, runnerInput, type RunnerInput } from '../shared/schemas';
import { ZodPipe } from '../zod.pipe';
import { RunnersService } from './runners.service';

@Controller('api')
@UseGuards(AuthGuard)
export class RunnersController {
    constructor(
        private readonly runners: RunnersService,
        private readonly members: MembersService,
    ) {}

    @Get('runners')
    list() {
        return this.runners.list();
    }

    /** The signed in player's runners, for picking who signs up. */
    @Get('runners/mine')
    mine(@CurrentUser() user: Me) {
        return this.runners.mine(user.id);
    }

    /** By link (name or handle) or UUID. */
    @Get('runners/:id')
    async get(@CurrentUser() user: Me, @Param('id') ref: string) {
        const id = await this.runners.resolve(ref);
        return this.runners.get(user, id);
    }

    @Post('runners')
    create(@CurrentUser() user: Me, @Body(new ZodPipe(runnerInput)) body: RunnerInput) {
        return this.runners.create(user, body);
    }

    @Patch('runners/:id')
    update(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(runnerInput)) body: RunnerInput) {
        return this.runners.update(user, id, body);
    }

    /** Retire, die, or come back. */
    @Post('runners/:id/status')
    retire(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(retireInput)) body: RetireInput) {
        return this.runners.retire(user, id, body);
    }

    @Delete('runners/:id')
    @HttpCode(204)
    delete(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string) {
        return this.runners.delete(user, id);
    }

    /** People who can be given a runner. Admins only. */
    @Get('players')
    players(@CurrentUser() user: Me) {
        if (!user.isAdmin) throw new ForbiddenException();
        return this.members.players();
    }

    @Get('fixers')
    fixers() {
        return this.runners.fixers();
    }
}
