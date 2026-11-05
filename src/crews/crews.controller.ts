import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { crewInput, type CrewInput, type Me, memberInput } from '../shared/schemas';
import { ZodPipe } from '../zod.pipe';
import { CrewsService } from './crews.service';

@Controller('api/crews')
@UseGuards(AuthGuard)
export class CrewsController {
    constructor(private readonly crews: CrewsService) {}

    @Get()
    list() {
        return this.crews.list();
    }

    @Get(':id')
    get(@Param('id', ParseIntPipe) id: number) {
        return this.crews.get(id);
    }

    @Post()
    create(@CurrentUser() user: Me, @Body(new ZodPipe(crewInput)) body: CrewInput) {
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
    addMember(@CurrentUser() user: Me, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(memberInput)) body: { userId: string }) {
        return this.crews.addMember(user, id, body.userId);
    }

    @Delete(':id/members/:userId')
    removeMember(@CurrentUser() user: Me, @Param('id', ParseIntPipe) id: number, @Param('userId') userId: string) {
        return this.crews.removeMember(user, id, userId);
    }
}
