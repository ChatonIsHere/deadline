import { HttpException, Injectable, Logger } from '@nestjs/common';
import { type ButtonInteraction, MessageFlags } from 'discord.js';
import {
    Button,
    type ButtonContext,
    ComponentParam,
    Context,
    type ContextOf,
    On,
    SelectedStrings,
    StringSelect,
    type StringSelectContext,
} from 'necord';
import { PrefsService } from '../auth/prefs.service';
import { config } from '../config';
import { DebriefService } from '../gigs/debrief.service';
import { GigsService } from '../gigs/gigs.service';
import { pickRunnerMessage } from './gig-embed';
import { GigPostService } from './gig-post.service';
import { voice } from './voice';

/** Buttons and menus on gig posts and DMs: sign up, pick a runner, confirm or drop out, rate the fixer. */
@Injectable()
export class GigInteractions {
    constructor(
        private readonly gigs: GigsService,
        private readonly posts: GigPostService,
        private readonly prefs: PrefsService,
        private readonly debrief: DebriefService,
    ) {}

    /** Live gig posts stay open. Discord archives quiet threads after a week, and people can close them by hand. */
    @On('threadUpdate')
    onThreadUpdate(@Context() [, thread]: ContextOf<'threadUpdate'>) {
        if ((thread.archived || thread.locked) && this.posts.isGigForum(thread.parentId)) this.gigs.keepOpen(thread.id);
    }

    /** Signs up. Players with several runners get a private menu to pick one first. */
    @Button('gig/join/:id')
    async join(@Context() [interaction]: ButtonContext, @ComponentParam('id') id: string) {
        const choices = this.gigs.runnerChoices(interaction.user.id, Number(id));
        if (choices.length) {
            await interaction.reply({ ...pickRunnerMessage(Number(id), choices), flags: MessageFlags.Ephemeral });
            return;
        }
        return this.answer(interaction, () => this.gigs.join(interaction.user.id, Number(id)));
    }

    /** The runner picked from that menu. */
    @StringSelect('gig/pick/:id')
    async pick(@Context() [interaction]: StringSelectContext, @ComponentParam('id') id: string, @SelectedStrings() [runnerId]: string[]) {
        try {
            const reply = await this.gigs.join(interaction.user.id, Number(id), Number(runnerId));
            await interaction.update({ content: reply, components: [] });
        } catch (err) {
            await interaction.update({ content: explain(err), components: [] });
        }
    }

    /** Star rating for the fixer, from the payout DM. Can be changed by picking again. */
    @StringSelect('rate/:id')
    async rate(@Context() [interaction]: StringSelectContext, @ComponentParam('id') id: string, @SelectedStrings() [stars]: string[]) {
        try {
            const reply = this.debrief.rate(interaction.user.id, Number(id), Number(stars));
            await interaction.reply(reply);
        } catch (err) {
            await interaction.reply(explain(err));
        }
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

    /** From a reminder DM. Turned back on from the web. */
    @Button('prefs/reminders/off')
    remindersOff(@Context() [interaction]: ButtonContext) {
        return this.answer(interaction, () => {
            this.prefs.set(interaction.user.id, { ...this.prefs.get(interaction.user.id), reminders: false });
            return voice.remindersOff(config.PUBLIC_URL);
        });
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
                await interaction.reply(explain(err));
            }
            return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            await interaction.editReply(await action());
        } catch (err) {
            await interaction.editReply(explain(err));
        }
    }
}

/** What to tell someone when an action fails. Our own errors say why; anything else stays vague. */
function explain(err: unknown): string {
    if (err instanceof HttpException) return voice.error(err.message);
    new Logger(GigInteractions.name).error(err);
    return voice.error(voice.broken);
}
