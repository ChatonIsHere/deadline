import { HttpException, Injectable, UseInterceptors } from '@nestjs/common';
import { type AutocompleteInteraction, MessageFlags } from 'discord.js';
import { AutocompleteInterceptor, Context, Options, SlashCommand, type SlashCommandContext, StringOption } from 'necord';
import { PrefsService } from '../auth/prefs.service';
import { config } from '../config';
import { CrewsService } from '../crews/crews.service';
import { GigsService } from '../gigs/gigs.service';
import { LibraryService } from '../library/library.service';
import { RunnersService } from '../runners/runners.service';
import { SettingsService } from '../settings/settings.service';
import { framedFile } from '../shared/images';
import { canLogIn } from '../shared/permissions';
import type { Me } from '../shared/schemas';
import { isUuid } from '../shared/slug';
import { gigCard, myGigsCard, runnerCard } from './cards';
import { crewCard } from './crew-messages';
import { EmojiService } from './emoji.service';
import { MembersService } from './members.service';
import { lineMessage } from './colours';
import { voice } from './voice';

// Options. Suggestions send IDs as values, but people can also type a name and press enter.

class GigOptions {
    @StringOption({ name: 'gig', description: 'Start typing a gig name', required: true, autocomplete: true })
    gig: string;
}

class RunnerOptions {
    @StringOption({ name: 'handle', description: 'Start typing a handle. Leave it out to see your own.', required: false, autocomplete: true })
    handle?: string;
}

class FixerOptions {
    @StringOption({ name: 'handle', description: "Start typing a fixer's handle", required: true, autocomplete: true })
    handle: string;
}

class CrewOptions {
    @StringOption({ name: 'name', description: 'Start typing a crew name', required: true, autocomplete: true })
    name: string;
}

class NewRunnerOptions {
    @StringOption({ name: 'handle', description: "Your runner's handle", required: true, max_length: 40 })
    handle: string;

    @StringOption({ name: 'role', description: 'Main role. Add extra roles and a picture on the web.', required: true, autocomplete: true })
    role: string;
}

class ReminderOptions {
    @StringOption({
        name: 'set',
        description: 'Session reminder DMs',
        required: true,
        choices: [
            { name: 'on', value: 'on' },
            { name: 'off', value: 'off' },
        ],
    })
    set: 'on' | 'off';
}

const fits = (text: string, typed: string) => text.toLowerCase().includes(typed.trim().toLowerCase());
const short = (text: string) => (text.length > 100 ? `${text.slice(0, 99)}…` : text);

/** Suggestions while typing: live gigs, runners, fixers, crews and roles. */
@Injectable()
class Suggestions extends AutocompleteInterceptor {
    constructor(
        private readonly gigs: GigsService,
        private readonly runners: RunnersService,
        private readonly settings: SettingsService,
        private readonly crews: CrewsService,
    ) {
        super();
    }

    async transformOptions(interaction: AutocompleteInteraction) {
        const typed = String(interaction.options.getFocused());
        let choices: { name: string; value: string }[] = [];
        switch (interaction.commandName) {
            case 'gig':
                choices = (await this.gigs.live()).filter((g) => fits(g.name, typed)).map((g) => ({ name: short(g.name), value: g.id }));
                break;
            case 'runner':
            case 'fixer':
                choices = (await this.runners.search(typed, interaction.commandName === 'fixer')).map((r) => ({ name: short(`${r.handle} (${r.role})`), value: r.id }));
                break;
            case 'crew':
                choices = (await this.crews.list()).filter((c) => fits(c.name, typed)).map((c) => ({ name: short(c.name), value: c.id }));
                break;
            case 'newrunner':
                choices = this.settings
                    .get()
                    .runnerRoles.filter((r) => fits(r, typed))
                    .map((r) => ({ name: r, value: r }));
                break;
        }
        return interaction.respond(choices.slice(0, 25));
    }
}

/** Slash commands. Lookups (/gig, /runner, /fixer, /crew) are posted for everyone; the rest are private. */
@Injectable()
export class Commands {
    constructor(
        private readonly gigs: GigsService,
        private readonly runners: RunnersService,
        private readonly members: MembersService,
        private readonly prefs: PrefsService,
        private readonly library: LibraryService,
        private readonly emoji: EmojiService,
        private readonly crews: CrewsService,
    ) {}

    @SlashCommand({ name: 'board', description: 'Link to the gig board' })
    async board(@Context() [interaction]: SlashCommandContext) {
        await interaction.reply({ ...lineMessage(voice.board(config.PUBLIC_URL, await this.gigs.countOpen())), flags: MessageFlags.Ephemeral });
    }

    @UseInterceptors(Suggestions)
    @SlashCommand({ name: 'gig', description: 'Show a live gig' })
    async gig(@Context() [interaction]: SlashCommandContext, @Options() { gig }: GigOptions) {
        // A suggestion's value is the gig's ID; someone may have typed a name instead
        const live = await this.gigs.live();
        const id = live.find((g) => g.id === gig)?.id ?? live.find((g) => g.name.toLowerCase() === gig.trim().toLowerCase())?.id;
        const view = id ? await this.gigs.view(id) : undefined;
        if (!view) return this.oops(interaction, 'no live gig by that name.');
        const image = view.imageId ? await this.library.attachment(framedFile(view.imageId)) : null;
        await interaction.reply({ ...gigCard(view, this.emoji.get, config.PUBLIC_URL, image && `attachment://${image.name}`), files: image ? [image] : [] });
    }

    @UseInterceptors(Suggestions)
    @SlashCommand({ name: 'runner', description: "Show a runner's card" })
    async runner(@Context() [interaction]: SlashCommandContext, @Options() { handle }: RunnerOptions) {
        const viewer = await this.viewer(interaction.user.id);
        try {
            if (handle) {
                const id = await this.resolve(handle, false);
                if (!id) return this.oops(interaction, 'no runner by that handle.');
                return await interaction.reply(await this.card(viewer, id));
            }
            // No handle: the player's own runners
            const mine = await this.runners.mine(interaction.user.id);
            if (!mine.length) return this.oops(interaction, "you don't have a runner yet. make one with /newrunner.");
            const cards = await Promise.all(mine.slice(0, 10).map((r) => this.card(viewer, r.id)));
            await interaction.reply(cards.length === 1 ? cards[0] : { embeds: cards.flatMap((c) => c.embeds), files: [...new Map(cards.flatMap((c) => c.files).map((f) => [f.name, f])).values()] });
        } catch {
            await this.oops(interaction, 'no runner by that handle.');
        }
    }

    @UseInterceptors(Suggestions)
    @SlashCommand({ name: 'fixer', description: "Show a fixer's profile and rating" })
    async fixer(@Context() [interaction]: SlashCommandContext, @Options() { handle }: FixerOptions) {
        const id = await this.resolve(handle, true);
        if (!id) return this.oops(interaction, 'no fixer by that handle.');
        try {
            await interaction.reply(await this.card(await this.viewer(interaction.user.id), id, 'fixer'));
        } catch {
            await this.oops(interaction, 'no fixer by that handle.');
        }
    }

    @UseInterceptors(Suggestions)
    @SlashCommand({ name: 'crew', description: 'Show a crew and its ranks' })
    async crew(@Context() [interaction]: SlashCommandContext, @Options() { name }: CrewOptions) {
        const all = await this.crews.list();
        const crew = all.find((c) => c.id === name) ?? all.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
        if (!crew) return this.oops(interaction, 'no crew by that name.');
        // Big crews spill over into more messages
        const [first, ...more] = crewCard(crew, this.emoji.get, config.PUBLIC_URL);
        await interaction.reply(first);
        for (const message of more) await interaction.followUp(message);
    }

    @UseInterceptors(Suggestions)
    @SlashCommand({ name: 'newrunner', description: 'Make a runner. Add a picture and more on the web.' })
    async newRunner(@Context() [interaction]: SlashCommandContext, @Options() { handle, role }: NewRunnerOptions) {
        const me = await this.members.me(interaction.user.id);
        if (!me || !canLogIn(me)) return this.oops(interaction, 'you need a role on the server to make a runner.');
        try {
            const runner = await this.runners.create(me, {
                handle,
                role: role.trim(),
                extraRoles: [],
                imageId: null,
                artIds: [],
                tagline: null,
                living: null,
                lifestyle: null,
                customLiving: null,
                fixerAlias: null,
                officeLocation: null,
                specialties: null,
                contact: null,
                bio: null,
            });
            await interaction.reply({ ...lineMessage(voice.runnerMade(runner.handle, `${config.PUBLIC_URL}/runners/${runner.slug}/edit`)), flags: MessageFlags.Ephemeral });
        } catch (err) {
            // Our own errors (bad role, taken name) say why; anything else stays vague
            await this.oops(interaction, err instanceof HttpException ? err.message : voice.broken);
        }
    }

    @SlashCommand({ name: 'mygigs', description: 'Live gigs your runners are on' })
    async myGigs(@Context() [interaction]: SlashCommandContext) {
        const gigs = await this.gigs.forPlayer(interaction.user.id);
        await interaction.reply({ ...myGigsCard(gigs, interaction.user.id, config.PUBLIC_URL), flags: MessageFlags.Ephemeral });
    }

    @SlashCommand({ name: 'reminders', description: 'Turn session reminder DMs on or off' })
    async reminders(@Context() [interaction]: SlashCommandContext, @Options() { set }: ReminderOptions) {
        const userId = interaction.user.id;
        await this.prefs.set(userId, { reminders: set === 'on' });
        await interaction.reply({ ...lineMessage(voice.remindersSet(set === 'on')), flags: MessageFlags.Ephemeral });
    }

    /** A suggested ID, or a typed handle. */
    private async resolve(typed: string, fixersOnly: boolean): Promise<string | undefined> {
        if (isUuid(typed)) return typed;
        return (await this.runners.search(typed, fixersOnly)).find((r) => r.handle.toLowerCase() === typed.trim().toLowerCase())?.id;
    }

    private async card(viewer: Me, id: string, side: 'runner' | 'fixer' = 'runner') {
        const view = await this.runners.get(viewer, id); // throws if the runner was deleted since it was suggested
        // Uploaded with the reply, so Discord serves it (see LibraryService.attachment)
        const image = view.imageId ? await this.library.attachment(framedFile(view.imageId)) : null;
        return { ...runnerCard(view, side, this.emoji.get, config.PUBLIC_URL, image && `attachment://${image.name}`), files: image ? [image] : [] };
    }

    /** Who's asking, so pending gigs stay hidden from people who can't see them. */
    private async viewer(userId: string): Promise<Me> {
        return (await this.members.me(userId)) ?? { id: userId, name: '', avatar: null, isOwner: false, isAdmin: false, isFixer: false, isEdgerunner: false, timezone: null, needsSetup: false };
    }

    private oops(interaction: SlashCommandContext[0], message: string) {
        return interaction.reply({ ...lineMessage(voice.error(message)), flags: MessageFlags.Ephemeral });
    }
}
