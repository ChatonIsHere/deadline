import { HttpException, Injectable, Logger, UseInterceptors } from '@nestjs/common';
import { type AutocompleteInteraction, type ChatInputCommandInteraction, LabelBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import {
    AutocompleteInterceptor,
    Button,
    type ButtonContext,
    ComponentParam,
    Context,
    createCommandGroupDecorator,
    MessageCommand,
    type MessageCommandContext,
    Modal,
    type ModalContext,
    ModalParam,
    Options,
    type SlashCommandContext,
    StringOption,
    Subcommand,
} from 'necord';
import { CacheService } from '../cache/cache.service';
import { type Actor, ChatsService, speakable } from '../chats/chats.service';
import { config } from '../config';
import { MAX_CHAT_NAME, MAX_MESSAGE } from '../shared/schemas';
import { isUuid } from '../shared/slug';
import { ChatRelayService, type Pending, pendingKey } from './chat-relay.service';
import { lineMessage } from './colours';
import { voice } from './voice';

const short = (text: string) => (text.length > 100 ? `${text.slice(0, 99)}…` : text);

/** Suggestions for /dm: characters to message, characters to speak as, and in a thread, the ones you have there. */
@Injectable()
class CharacterSuggestions extends AutocompleteInterceptor {
    constructor(
        private readonly chats: ChatsService,
        private readonly relay: ChatRelayService,
    ) {
        super();
    }

    async transformOptions(interaction: AutocompleteInteraction) {
        const focused = interaction.options.getFocused(true);
        const typed = String(focused.value);
        const user = await this.relay.actor(interaction.user.id);
        const sub = interaction.options.getSubcommand(false);
        let choices: { name: string; value: string }[] = [];
        if (focused.name === 'as' && sub !== 'new') {
            // In a thread: the characters they can speak as there
            const chat = interaction.channel?.isThread() ? await this.chats.byThread(interaction.channelId) : null;
            choices = chat ? speakable(user, chat).filter((r) => r.handle.toLowerCase().includes(typed.toLowerCase())).map((r) => ({ name: short(r.handle), value: r.id })) : [];
        } else {
            const side = focused.name === 'as' ? 'as' : 'to';
            choices = (await this.chats.characters(user, side, typed)).map((r) => ({ name: short(r.isNpc ? `${r.handle} (NPC)` : r.handle), value: r.id }));
        }
        return interaction.respond(choices.slice(0, 25));
    }
}

class NewOptions {
    @StringOption({ name: 'to', description: 'Who to message. Start typing a handle.', required: true, autocomplete: true })
    to: string;
    @StringOption({ name: 'as', description: 'Which of your characters is speaking. Needed if you have more than one.', required: false, autocomplete: true })
    as?: string;
    @StringOption({ name: 'and', description: 'Someone else, for a group chat', required: false, autocomplete: true })
    and?: string;
    @StringOption({ name: 'and2', description: 'Someone else, for a group chat', required: false, autocomplete: true })
    and2?: string;
    @StringOption({ name: 'and3', description: 'Someone else, for a group chat', required: false, autocomplete: true })
    and3?: string;
    @StringOption({ name: 'name', description: "A group chat's name", required: false, max_length: MAX_CHAT_NAME })
    name?: string;
}

class AsOptions {
    @StringOption({ name: 'as', description: 'Which of your characters speaks when you type here', required: true, autocomplete: true })
    as: string;
}

class SayOptions {
    @StringOption({ name: 'as', description: 'Which character says it', required: true, autocomplete: true })
    as: string;
    @StringOption({ name: 'text', description: 'What they say', required: true, max_length: MAX_MESSAGE })
    text: string;
}

class AddOptions {
    @StringOption({ name: 'who', description: 'Start typing a handle', required: true, autocomplete: true })
    who: string;
}

class LeaveOptions {
    @StringOption({ name: 'as', description: 'Which of your characters leaves. Needed if you have more than one here.', required: false, autocomplete: true })
    as?: string;
}

const DmCommand = createCommandGroupDecorator({ name: 'dm', description: 'Chats between characters, here and on the web' });

/**
 * /dm and the message menus for chat threads. Everything goes through ChatsService, so the
 * rules are the web's. Answers are private.
 */
@DmCommand()
@Injectable()
export class ChatInteractions {
    private readonly logger = new Logger(ChatInteractions.name);

    constructor(
        private readonly chats: ChatsService,
        private readonly relay: ChatRelayService,
        private readonly cache: CacheService,
    ) {}

    /** Opens your direct chat with someone (or starts a group with several) and links its thread. */
    @UseInterceptors(CharacterSuggestions)
    @Subcommand({ name: 'new', description: 'Message a character, or start a group chat' })
    async new(@Context() [interaction]: SlashCommandContext, @Options() options: NewOptions) {
        await this.run(interaction, async () => {
            const user = await this.relay.actor(interaction.user.id);
            const own = await this.chats.characters(user, 'as');
            const as = options.as ? await this.pick(options.as, own) : own.length === 1 ? own[0].id : undefined;
            if (!as) return own.length ? 'say which of your characters is speaking, with `as`.' : "you need an active character first. make one on the web.";
            const others = await this.chats.characters(user, 'to');
            const recipientIds: string[] = [];
            for (const typed of [options.to, options.and, options.and2, options.and3]) {
                if (!typed) continue;
                const id = await this.pick(typed, others);
                if (!id) return `no character called "${typed}".`;
                recipientIds.push(id);
            }
            const summary = await this.chats.create(user, { asRunnerId: as, recipientIds, name: options.name?.trim() || null });
            const chat = await this.chats.find(summary.id);
            const thread = chat && (await this.relay.ensureThread(chat));
            const web = `${config.PUBLIC_URL}/messages/${summary.id}`;
            return thread ? `**${summary.title}**: <#${thread.id}> (or [on the web](${web})).` : `**${summary.title}** is [on the web](${web}). chats only reach Discord once an admin picks a DM channel.`;
        });
    }

    /** Which character you are when you type in this thread. */
    @UseInterceptors(CharacterSuggestions)
    @Subcommand({ name: 'as', description: 'Pick which of your characters speaks when you type in this chat' })
    async as(@Context() [interaction]: SlashCommandContext, @Options() { as }: AsOptions) {
        await this.run(interaction, async () => {
            const { user, chat } = await this.here(interaction);
            const runner = speakable(user, chat).find((r) => r.id === as || r.handle.toLowerCase() === as.trim().toLowerCase());
            if (!runner) return "you can't speak as that character here.";
            await this.chats.setVoice(chat.id, user.id, runner.id);
            return `you're **${runner.handle}** in this chat now.`;
        });
    }

    /** One message as another of your characters, without changing who you are here. */
    @UseInterceptors(CharacterSuggestions)
    @Subcommand({ name: 'say', description: 'Send one message here as a different character' })
    async say(@Context() [interaction]: SlashCommandContext, @Options() { as, text }: SayOptions) {
        await this.run(interaction, async () => {
            const { user, chat } = await this.here(interaction);
            const runner = speakable(user, chat).find((r) => r.id === as || r.handle.toLowerCase() === as.trim().toLowerCase());
            if (!runner) return "you can't speak as that character here.";
            await this.chats.send(user, chat.id, { asRunnerId: runner.id, body: text.trim(), imageIds: [] });
            return `sent as **${runner.handle}**.`;
        });
    }

    @UseInterceptors(CharacterSuggestions)
    @Subcommand({ name: 'add', description: 'Bring another character into this group chat' })
    async add(@Context() [interaction]: SlashCommandContext, @Options() { who }: AddOptions) {
        await this.run(interaction, async () => {
            const { user, chat } = await this.here(interaction);
            const id = await this.pick(who, await this.chats.characters(user, 'to'));
            if (!id) return `no character called "${who}".`;
            const summary = await this.chats.addMember(user, chat.id, id);
            return `**${summary.members.find((m) => m.id === id)?.handle}** is in the chat.`;
        });
    }

    @UseInterceptors(CharacterSuggestions)
    @Subcommand({ name: 'leave', description: 'Take one of your characters out of this group chat' })
    async leave(@Context() [interaction]: SlashCommandContext, @Options() { as }: LeaveOptions) {
        await this.run(interaction, async () => {
            const { user, chat } = await this.here(interaction);
            const mine = chat.members.map((m) => m.runner).filter((r) => r.ownerId === user.id || (user.isAdmin && !r.ownerId));
            const runner = as ? mine.find((r) => r.id === as || r.handle.toLowerCase() === as.trim().toLowerCase()) : mine.length === 1 ? mine[0] : undefined;
            if (!runner) return mine.length ? 'say which character leaves, with `as`.' : "you've no character in this chat.";
            await this.chats.leave(user, chat.id, runner.id);
            return `**${runner.handle}** left the chat.`;
        });
    }

    /** The answer to "speak as which character?": sends the held message, and remembers the pick for this chat. */
    @Button('chat/as/:token/:runner')
    async speakAs(@Context() [interaction]: ButtonContext, @ComponentParam('token') token: string, @ComponentParam('runner') runnerId: string) {
        const pending = await this.cache.get<Pending>(pendingKey(token));
        if (!pending) return interaction.reply({ ...lineMessage(voice.error('that message timed out. send it again.')), flags: MessageFlags.Ephemeral });
        if (pending.userId !== interaction.user.id) return interaction.reply({ ...lineMessage(voice.error("that's someone else's question.")), flags: MessageFlags.Ephemeral });
        try {
            const user = await this.relay.actor(interaction.user.id);
            await this.chats.setVoice(pending.chatId, user.id, runnerId);
            await this.cache.del(pendingKey(token));
            await this.relay.sendFrom(user, pending.chatId, runnerId, pending.body, pending.imageIds);
            await interaction.deferUpdate();
            await interaction.message.delete().catch(() => undefined);
        } catch (err) {
            await interaction.reply({ ...lineMessage(explain(err, this.logger)), flags: MessageFlags.Ephemeral });
        }
    }

    /** Players can't edit the webhook's copies of their messages, so this does it for them. */
    @MessageCommand({ name: 'Edit message' })
    async editMenu(@Context() [interaction]: MessageCommandContext) {
        const message = await this.chats.byDiscordMessage(interaction.targetMessage.id);
        if (!message || message.deletedAt) return interaction.reply({ ...lineMessage(voice.error("that isn't a chat message.")), flags: MessageFlags.Ephemeral });
        if (message.sentBy !== interaction.user.id) return interaction.reply({ ...lineMessage(voice.error('you can only edit your own messages.')), flags: MessageFlags.Ephemeral });
        const body = new TextInputBuilder().setCustomId('body').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(MAX_MESSAGE).setValue(message.body.slice(0, MAX_MESSAGE));
        const modal = new ModalBuilder()
            .setCustomId(`chat/edit/${message.id}`)
            .setTitle(`Edit ${message.runner.handle}'s message`.slice(0, 45))
            .addLabelComponents(new LabelBuilder().setLabel('Message').setTextInputComponent(body));
        await interaction.showModal(modal);
    }

    @Modal('chat/edit/:id')
    async edited(@Context() [interaction]: ModalContext, @ModalParam('id') id: string) {
        try {
            const message = isUuid(id) ? await this.chats.messageById(id) : null;
            if (!message) throw new Error('gone');
            const body = interaction.fields.getTextInputValue('body').trim();
            await this.chats.edit(await this.relay.actor(interaction.user.id), message.chatId, id, body);
            await interaction.reply({ ...lineMessage(voice.chat('edited.')), flags: MessageFlags.Ephemeral });
        } catch (err) {
            await interaction.reply({ ...lineMessage(explain(err, this.logger)), flags: MessageFlags.Ephemeral });
        }
    }

    @MessageCommand({ name: 'Delete message' })
    async deleteMenu(@Context() [interaction]: MessageCommandContext) {
        try {
            const message = await this.chats.byDiscordMessage(interaction.targetMessage.id);
            if (!message || message.deletedAt) return interaction.reply({ ...lineMessage(voice.error("that isn't a chat message.")), flags: MessageFlags.Ephemeral });
            await this.chats.remove(await this.relay.actor(interaction.user.id), message.chatId, message.id);
            await interaction.reply({ ...lineMessage(voice.chat('deleted, here and on the web.')), flags: MessageFlags.Ephemeral });
        } catch (err) {
            await interaction.reply({ ...lineMessage(explain(err, this.logger)), flags: MessageFlags.Ephemeral });
        }
    }

    /** The chat whose thread the command was used in. */
    private async here(interaction: ChatInputCommandInteraction) {
        const chat = interaction.channel?.isThread() ? await this.chats.byThread(interaction.channelId) : null;
        if (!chat) throw new HttpException("use this in a chat's thread.", 400);
        const user: Actor = await this.relay.actor(interaction.user.id);
        return { user, chat };
    }

    /** A suggested ID, or a typed handle, among these characters. */
    private async pick(typed: string, among: { id: string; handle: string }[]): Promise<string | undefined> {
        if (isUuid(typed)) return among.find((r) => r.id === typed.toLowerCase())?.id;
        return among.find((r) => r.handle.toLowerCase() === typed.trim().toLowerCase())?.id;
    }

    /** Runs a command and answers privately with how it went. */
    private async run(interaction: ChatInputCommandInteraction, action: () => Promise<string>) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            await interaction.editReply(lineMessage(voice.chat(await action())));
        } catch (err) {
            await interaction.editReply(lineMessage(explain(err, this.logger)));
        }
    }
}

function explain(err: unknown, logger: Logger) {
    if (err instanceof HttpException) return voice.error(err.message.charAt(0).toLowerCase() + err.message.slice(1));
    logger.error(err);
    return voice.error(voice.broken);
}
