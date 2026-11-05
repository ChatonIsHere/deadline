import { Injectable } from '@nestjs/common';
import { MessageFlags } from 'discord.js';
import { Button, type ButtonContext, ComponentParam, Context, type ContextOf, On, SlashCommand, type SlashCommandContext } from 'necord';
import { config } from '../config';
import { GigsService } from '../gigs/gigs.service';
import { GigPostService } from './gig-post.service';
import { voice } from './voice';

/** The only things people do from Discord: take or drop a gig, and find the board. */
@Injectable()
export class GigInteractions {
    constructor(
        private readonly gigs: GigsService,
        private readonly posts: GigPostService,
    ) {}

    /** Live gig posts stay open. Discord archives quiet threads after a week, and people can close them by hand. */
    @On('threadUpdate')
    onThreadUpdate(@Context() [, thread]: ContextOf<'threadUpdate'>) {
        if ((thread.archived || thread.locked) && this.posts.isGigForum(thread.parentId)) this.gigs.keepOpen(thread.id);
    }

    @Button('gig/join/:id')
    async join(@Context() [interaction]: ButtonContext, @ComponentParam('id') id: string) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const left = await this.gigs.join(interaction.user.id, Number(id));
            await interaction.editReply(voice.joined(left));
        } catch (err) {
            await interaction.editReply(voice.error((err as Error).message));
        }
    }

    @Button('gig/leave/:id')
    async leave(@Context() [interaction]: ButtonContext, @ComponentParam('id') id: string) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            this.gigs.leave(interaction.user.id, Number(id));
            await interaction.editReply(voice.left());
        } catch (err) {
            await interaction.editReply(voice.error((err as Error).message));
        }
    }

    @SlashCommand({ name: 'board', description: 'Link to the gig board' })
    async board(@Context() [interaction]: SlashCommandContext) {
        await interaction.reply({ content: voice.board(config.PUBLIC_URL, this.gigs.countOpen()), flags: MessageFlags.Ephemeral });
    }
}
