import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Put, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { GigPostService } from '../discord/gig-post.service';
import { MembersService } from '../discord/members.service';
import { type Me, type Settings, settingsInput, type SettingsView } from '../shared/schemas';
import { ZodPipe } from '../zod.pipe';
import { SettingsService } from './settings.service';

@Controller('api/settings')
@UseGuards(AuthGuard)
export class SettingsController {
    constructor(
        private readonly settings: SettingsService,
        private readonly members: MembersService,
        private readonly posts: GigPostService,
    ) {}

    @Get()
    async get(@CurrentUser() user: Me): Promise<SettingsView> {
        if (!user.isAdmin) throw new ForbiddenException();
        const current = this.settings.get();
        const guilds = this.settings.guilds().filter((g) => user.isOwner || g.id === current.guildId);
        return {
            settings: current,
            guilds,
            options: current.guildId ? await this.settings.options(current.guildId).catch(() => null) : null,
            inviteUrl: this.settings.inviteUrl(),
        };
    }

    /** Forums and roles of another server, while the owner is picking one. */
    @Get('guilds/:id')
    options(@CurrentUser() user: Me, @Param('id') id: string) {
        if (!user.isOwner && !(user.isAdmin && id === this.settings.get().guildId)) throw new ForbiddenException();
        return this.settings.options(id);
    }

    @Put()
    async save(@CurrentUser() user: Me, @Body(new ZodPipe(settingsInput)) body: Settings): Promise<SettingsView> {
        await this.settings.save(user, body);
        await this.members.load();
        try {
            await this.posts.setupForum();
        } catch (err) {
            throw new BadRequestException(`Saved, but the forum tags couldn't be added. Give the bot Manage Channels there. (${err})`);
        }
        return this.get(user);
    }
}
