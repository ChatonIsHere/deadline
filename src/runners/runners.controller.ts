import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { type Me, runnerInput, type RunnerInput } from '../shared/schemas';
import { ZodPipe } from '../zod.pipe';
import { RunnersService } from './runners.service';

@Controller('api')
@UseGuards(AuthGuard)
export class RunnersController {
    constructor(private readonly runners: RunnersService) {}

    @Get('runners')
    list() {
        return this.runners.list();
    }

    /** The signed in player's runners, for picking who signs up. */
    @Get('runners/mine')
    mine(@CurrentUser() user: Me) {
        return this.runners.mine(user.id);
    }

    @Get('runners/:id')
    get(@CurrentUser() user: Me, @Param('id', ParseIntPipe) id: number) {
        return this.runners.get(user, id);
    }

    @Post('runners')
    create(@CurrentUser() user: Me, @Body(new ZodPipe(runnerInput)) body: RunnerInput) {
        return this.runners.create(user, body);
    }

    @Patch('runners/:id')
    update(@CurrentUser() user: Me, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(runnerInput)) body: RunnerInput) {
        return this.runners.update(user, id, body);
    }

    @Delete('runners/:id')
    @HttpCode(204)
    delete(@CurrentUser() user: Me, @Param('id', ParseIntPipe) id: number) {
        this.runners.delete(user, id);
    }

    @Get('fixers')
    fixers() {
        return this.runners.fixers();
    }
}
