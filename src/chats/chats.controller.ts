import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import {
    chatMessageInput,
    type ChatMessageInput,
    chatNotifyInput,
    editMessageInput,
    type Me,
    newChatInput,
    type NewChatInput,
    renameChatInput,
    runnerRefInput,
} from '../shared/schemas';
import { ZodPipe } from '../zod.pipe';
import { ChatsService } from './chats.service';

@Controller('api/chats')
@UseGuards(AuthGuard)
export class ChatsController {
    constructor(private readonly chats: ChatsService) {}

    /** Newest first. Archived ones (finished gigs, gone crews) with ?archived=1. */
    @Get()
    list(@CurrentUser() user: Me, @Query('archived') archived?: string) {
        return this.chats.list(user, { archived: archived === '1' });
    }

    /** The chats the signed in player gets push notifications for. */
    @Get('notifying')
    notifying(@CurrentUser() user: Me) {
        return this.chats.notifying(user);
    }

    /** Who you can start chats as (?side=as) or message (?side=to). */
    @Get('characters')
    characters(@CurrentUser() user: Me, @Query('side') side?: string) {
        return this.chats.characters(user, side === 'as' ? 'as' : 'to');
    }

    @Post()
    create(@CurrentUser() user: Me, @Body(new ZodPipe(newChatInput)) body: NewChatInput) {
        return this.chats.create(user, body);
    }

    @Get(':id')
    get(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string) {
        return this.chats.get(user, id);
    }

    @Patch(':id')
    rename(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(renameChatInput)) body: { name: string | null }) {
        return this.chats.rename(user, id, body.name);
    }

    @Get(':id/messages')
    messages(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string, @Query('before', new ParseUUIDPipe({ optional: true })) before?: string) {
        return this.chats.messages(user, id, before);
    }

    @Post(':id/messages')
    send(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(chatMessageInput)) body: ChatMessageInput) {
        return this.chats.send(user, id, body);
    }

    @Patch(':id/messages/:messageId')
    edit(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string, @Param('messageId', ParseUUIDPipe) messageId: string, @Body(new ZodPipe(editMessageInput)) body: { body: string }) {
        return this.chats.edit(user, id, messageId, body.body);
    }

    @Delete(':id/messages/:messageId')
    remove(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string, @Param('messageId', ParseUUIDPipe) messageId: string) {
        return this.chats.remove(user, id, messageId);
    }

    @Post(':id/members')
    addMember(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(runnerRefInput)) body: { runnerId: string }) {
        return this.chats.addMember(user, id, body.runnerId);
    }

    @Delete(':id/members/:runnerId')
    @HttpCode(204)
    async leave(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string, @Param('runnerId', ParseUUIDPipe) runnerId: string) {
        await this.chats.leave(user, id, runnerId);
    }

    @Post(':id/read')
    @HttpCode(204)
    async read(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string) {
        await this.chats.read(user, id);
    }

    @Put(':id/notify')
    @HttpCode(204)
    async notify(@CurrentUser() user: Me, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(chatNotifyInput)) body: { on: boolean }) {
        await this.chats.setNotify(user, id, body.on);
    }
}
