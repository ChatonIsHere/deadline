import { Injectable } from '@nestjs/common';
import { type ButtonInteraction, MessageFlags } from 'discord.js';
import { Button, type ButtonContext, ComponentParam, Context, type ContextOf, On, SlashCommand, type SlashCommandContext } from 'necord';
import { config } from '../config';
import { GigsService } from '../gigs/gigs.service';
import { GigPostService } from './gig-post.service';
import { voice } from './voice';

/** The only things people do from Discord: sign up, confirm or drop out, and find the board. */
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
    join(@Context() [interaction]: ButtonContext, @ComponentParam('id') id: string) {
        return this.answer(interaction, () => this.gigs.join(interaction.user.id, Number(id)));
    }

    @Button('gig/confirm/:id')
    confirm(@Context() [interaction]: ButtonContext, @ComponentParam('id') id: string) {
        return this.answer(interaction, () => this.gigs.confirm(interaction.user.id, Number(id)));
    }

    @Button('gig/leave/:id')
    leave(@Context() [interaction]: ButtonContext, @ComponentParam('id') id: string) {
        return this.answer(interaction, () => {
            this.gigs.leave(interaction.user.id, Number(id));
            return voice.left();
        });
    }

    @SlashCommand({ name: 'board', description: 'Link to the gig board' })
    async board(@Context() [interaction]: SlashCommandContext) {
        await interaction.reply({ content: voice.board(config.PUBLIC_URL, this.gigs.countOpen()), flags: MessageFlags.Ephemeral });
    }

    /**
     * Runs a button's action and tells the person how it went. A DM asking someone to
     * confirm is only theirs, so it gets replaced by the answer. In the server the
     * answer is private.
     */
    private async answer(interaction: ButtonInteraction, action: () => string | Promise<string>) {
        if (!interaction.inGuild()) {
            try {
                await interaction.update({ content: await action(), components: [] });
            } catch (err) {
                await interaction.reply(voice.error((err as Error).message));
            }
            return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            await interaction.editReply(await action());
        } catch (err) {
            await interaction.editReply(voice.error((err as Error).message));
        }
    }
}
