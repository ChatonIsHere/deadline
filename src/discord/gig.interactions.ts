import { HttpException, Injectable, Logger } from '@nestjs/common';
import { type ButtonInteraction, LabelBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import {
    Button,
    type ButtonContext,
    ComponentParam,
    Context,
    type ContextOf,
    Modal,
    type ModalContext,
    ModalParam,
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
import { lineMessage, lineReplacing } from './colours';
import { GigPostService } from './gig-post.service';
import { type Said, voice } from './voice';

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
    async onThreadUpdate(@Context() [, thread]: ContextOf<'threadUpdate'>) {
        if ((thread.archived || thread.locked) && this.posts.isGigForum(thread.parentId)) await this.gigs.keepOpen(thread.id);
    }

    /** Signs up. Players with several runners get a private menu to pick one first. */
    @Button('gig/join/:id')
    async join(@Context() [interaction]: ButtonContext, @ComponentParam('id') id: string) {
        const choices = await this.gigs.runnerChoices(interaction.user.id, id);
        if (choices.length) {
            await interaction.reply({ ...pickRunnerMessage(id, choices), flags: MessageFlags.Ephemeral });
            return;
        }
        return this.answer(interaction, () => this.gigs.join(interaction.user.id, id));
    }

    /** The runner picked from that menu. */
    @StringSelect('gig/pick/:id')
    async pick(@Context() [interaction]: StringSelectContext, @ComponentParam('id') id: string, @SelectedStrings() [runnerId]: string[]) {
        try {
            await interaction.update(lineReplacing(await this.gigs.join(interaction.user.id, id, runnerId)));
        } catch (err) {
            await interaction.update(lineReplacing(explain(err)));
        }
    }

    /**
     * Star rating for the fixer, from the payout DM. The stars are saved straight away, then
     * a box asks for an optional note. Closing it keeps the stars. Picking again changes them.
     */
    @StringSelect('rate/:id')
    async rate(@Context() [interaction]: StringSelectContext, @ComponentParam('id') id: string, @SelectedStrings() [stars]: string[]) {
        try {
            await this.debrief.rate(interaction.user.id, id, Number(stars));
        } catch (err) {
            return interaction.reply(lineMessage(explain(err)));
        }
        const note = new TextInputBuilder().setCustomId('comment').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(300);
        const existing = (await this.debrief.myRating(interaction.user.id, id))?.comment;
        if (existing) note.setValue(existing);
        const modal = new ModalBuilder()
            .setCustomId(`rate/comment/${id}/${stars}`)
            .setTitle(voice.rateComment(Number(stars)))
            .addLabelComponents(new LabelBuilder().setLabel('Note for the fixer (optional)').setTextInputComponent(note));
        await interaction.showModal(modal);
    }

    @Modal('rate/comment/:id/:stars')
    async rateComment(@Context() [interaction]: ModalContext, @ModalParam('id') id: string, @ModalParam('stars') stars: string) {
        try {
            const comment = interaction.fields.getTextInputValue('comment').trim().slice(0, 300) || null;
            await interaction.reply(lineMessage(await this.debrief.rate(interaction.user.id, id, Number(stars), comment)));
        } catch (err) {
            await interaction.reply(lineMessage(explain(err)));
        }
    }

    @Button('gig/confirm/:id')
    confirm(@Context() [interaction]: ButtonContext, @ComponentParam('id') id: string) {
        return this.answer(interaction, () => this.gigs.confirm(interaction.user.id, id));
    }

    @Button('gig/leave/:id')
    leave(@Context() [interaction]: ButtonContext, @ComponentParam('id') id: string) {
        return this.answer(interaction, async () => {
            await this.gigs.leave(interaction.user.id, id);
            return voice.left();
        });
    }

    /** From a reminder DM. Turned back on from the web. */
    @Button('prefs/reminders/off')
    remindersOff(@Context() [interaction]: ButtonContext) {
        return this.answer(interaction, async () => {
            await this.prefs.set(interaction.user.id, { reminders: false });
            return voice.remindersOff(config.PUBLIC_URL);
        });
    }

    /**
     * Runs a button's action and tells the person how it went. A DM asking someone to
     * confirm is only theirs, so it gets replaced by the answer. In the server the
     * answer is private.
     */
    private async answer(interaction: ButtonInteraction, action: () => Said | Promise<Said>) {
        if (!interaction.inGuild()) {
            try {
                await interaction.update(lineReplacing(await action()));
            } catch (err) {
                await interaction.reply(lineMessage(explain(err)));
            }
            return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            await interaction.editReply(lineMessage(await action()));
        } catch (err) {
            await interaction.editReply(lineMessage(explain(err)));
        }
    }
}

/** What to tell someone when an action fails. Our own errors say why; anything else stays vague. */
export function explain(err: unknown): Said {
    if (err instanceof HttpException) return voice.error(err.message);
    new Logger(GigInteractions.name).error(err);
    return voice.error(voice.broken);
}
