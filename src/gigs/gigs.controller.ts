import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { GigPostService } from '../discord/gig-post.service';
import { gigInput, type GigInput, type Me, statusInput, type StatusInput } from '../shared/schemas';
import { ZodPipe } from '../zod.pipe';
import { GigsService } from './gigs.service';

@Controller('api/gigs')
@UseGuards(AuthGuard)
export class GigsController {
    constructor(
        private readonly gigs: GigsService,
        private readonly posts: GigPostService,
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

    @Get(':id')
    get(@CurrentUser() user: Me, @Param('id', ParseIntPipe) id: number) {
        return this.gigs.get(user, id);
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
}
