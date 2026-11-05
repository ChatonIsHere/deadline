import { Injectable, UseInterceptors } from '@nestjs/common';
import { type AutocompleteInteraction, MessageFlags } from 'discord.js';
import { AutocompleteInterceptor, Context, Options, SlashCommand, type SlashCommandContext, StringOption } from 'necord';
import { PrefsService } from '../auth/prefs.service';
import { config } from '../config';
import { GigsService } from '../gigs/gigs.service';
import { LibraryService } from '../library/library.service';
import { RunnersService } from '../runners/runners.service';
import { SettingsService } from '../settings/settings.service';
import { canLogIn } from '../shared/permissions';
import type { Me } from '../shared/schemas';
import { gigCard, myGigsCard, runnerCard } from './cards';
import { EmojiService } from './emoji.service';
import { MembersService } from './members.service';
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

/** Suggestions while typing: live gigs, runners, fixers and roles. */
@Injectable()
class Suggestions extends AutocompleteInterceptor {
    constructor(
        private readonly gigs: GigsService,
        private readonly runners: RunnersService,
        private readonly settings: SettingsService,
    ) {
        super();
    }

    transformOptions(interaction: AutocompleteInteraction) {
        const typed = String(interaction.options.getFocused());
        let choices: { name: string; value: string }[] = [];
        switch (interaction.commandName) {
            case 'gig':
                choices = this.gigs
                    .live()
                    .filter((g) => fits(g.name, typed))
                    .map((g) => ({ name: short(g.name), value: String(g.id) }));
                break;
            case 'runner':
            case 'fixer':
                choices = this.runners.search(typed, interaction.commandName === 'fixer').map((r) => ({ name: short(`${r.handle} (${r.role})`), value: String(r.id) }));
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

/** Slash commands. Lookups (/gig, /runner, /fixer) are posted for everyone; the rest are private. */
@Injectable()
export class Commands {
    constructor(
        private readonly gigs: GigsService,
        private readonly runners: RunnersService,
        private readonly members: MembersService,
        private readonly prefs: PrefsService,
        private readonly library: LibraryService,
        private readonly emoji: EmojiService,
    ) {}

    @SlashCommand({ name: 'board', description: 'Link to the gig board' })
    async board(@Context() [interaction]: SlashCommandContext) {
        await interaction.reply({ content: voice.board(config.PUBLIC_URL, this.gigs.countOpen()), flags: MessageFlags.Ephemeral });
    }

    @UseInterceptors(Suggestions)
    @SlashCommand({ name: 'gig', description: 'Show a live gig' })
    async gig(@Context() [interaction]: SlashCommandContext, @Options() { gig }: GigOptions) {
        const id = Number(gig) || this.gigs.live().find((g) => g.name.toLowerCase() === gig.trim().toLowerCase())?.id;
        const view = id ? this.gigs.view(id) : undefined;
        if (!view || (view.status !== 'open' && view.status !== 'closed')) return this.oops(interaction, 'no live gig by that name.');
        const image = view.imageId ? this.library.url(view.imageId) : null;
        await interaction.reply(gigCard(view, this.emoji.get, config.PUBLIC_URL, image));
    }

    @UseInterceptors(Suggestions)
    @SlashCommand({ name: 'runner', description: "Show a runner's card" })
    async runner(@Context() [interaction]: SlashCommandContext, @Options() { handle }: RunnerOptions) {
        const viewer = await this.viewer(interaction.user.id);
        try {
            if (handle) {
                const id = this.resolve(handle, false);
                if (!id) return this.oops(interaction, 'no runner by that handle.');
                return await interaction.reply(this.card(viewer, id));
            }
            // No handle: the player's own runners
            const mine = this.runners.mine(interaction.user.id);
            if (!mine.length) return this.oops(interaction, "you don't have a runner yet. make one with /newrunner.");
            const cards = mine.slice(0, 10).map((r) => this.card(viewer, r.id));
            await interaction.reply(cards.length === 1 ? cards[0] : { embeds: cards.flatMap((c) => c.embeds) });
        } catch {
            await this.oops(interaction, 'no runner by that handle.');
        }
    }

    @UseInterceptors(Suggestions)
    @SlashCommand({ name: 'fixer', description: "Show a fixer's profile and rating" })
    async fixer(@Context() [interaction]: SlashCommandContext, @Options() { handle }: FixerOptions) {
        const id = this.resolve(handle, true);
        if (!id) return this.oops(interaction, 'no fixer by that handle.');
        try {
            await interaction.reply(this.card(await this.viewer(interaction.user.id), id));
        } catch {
            await this.oops(interaction, 'no fixer by that handle.');
        }
    }

    @UseInterceptors(Suggestions)
    @SlashCommand({ name: 'newrunner', description: 'Make a runner. Add a picture and more on the web.' })
    async newRunner(@Context() [interaction]: SlashCommandContext, @Options() { handle, role }: NewRunnerOptions) {
        const me = await this.members.me(interaction.user.id);
        if (!me || !canLogIn(me)) return this.oops(interaction, 'you need a role on the server to make a runner.');
        try {
            const runner = this.runners.create(me, {
                handle,
                role: role.trim(),
                extraRoles: [],
                imageId: null,
                officeLocation: null,
                specialties: null,
                contact: null,
                bio: null,
            });
            await interaction.reply({ content: voice.runnerMade(runner.handle, `${config.PUBLIC_URL}/runners/${runner.id}/edit`), flags: MessageFlags.Ephemeral });
        } catch (err) {
            await this.oops(interaction, (err as Error).message);
        }
    }

    @SlashCommand({ name: 'mygigs', description: 'Live gigs your runners are on' })
    async myGigs(@Context() [interaction]: SlashCommandContext) {
        const gigs = this.gigs.forPlayer(interaction.user.id);
        await interaction.reply({ ...myGigsCard(gigs, interaction.user.id, config.PUBLIC_URL), flags: MessageFlags.Ephemeral });
    }

    @SlashCommand({ name: 'reminders', description: 'Turn session reminder DMs on or off' })
    async reminders(@Context() [interaction]: SlashCommandContext, @Options() { set }: ReminderOptions) {
        const userId = interaction.user.id;
        this.prefs.set(userId, { ...this.prefs.get(userId), reminders: set === 'on' });
        await interaction.reply({ content: voice.remindersSet(set === 'on'), flags: MessageFlags.Ephemeral });
    }

    /** A suggested ID, or a typed handle. */
    private resolve(typed: string, fixersOnly: boolean): number | undefined {
        if (Number(typed)) return Number(typed);
        return this.runners.search(typed, fixersOnly).find((r) => r.handle.toLowerCase() === typed.trim().toLowerCase())?.id;
    }

    private card(viewer: Me, id: number) {
        const view = this.runners.get(viewer, id); // throws if the runner was deleted since it was suggested
        return runnerCard(view, config.PUBLIC_URL, view.imageId ? this.library.url(view.imageId) : null);
    }

    /** Who's asking, so pending gigs stay hidden from people who can't see them. */
    private async viewer(userId: string): Promise<Me> {
        return (await this.members.me(userId)) ?? { id: userId, name: '', avatar: null, isOwner: false, isAdmin: false, isFixer: false, isEdgerunner: false };
    }

    private oops(interaction: SlashCommandContext[0], message: string) {
        return interaction.reply({ content: voice.error(message), flags: MessageFlags.Ephemeral });
    }
}
