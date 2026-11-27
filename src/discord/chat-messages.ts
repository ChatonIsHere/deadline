import { type APIEmbed, ButtonStyle, ComponentType, type MessageCreateOptions } from 'discord.js';
import { SITE } from './colours';

/** Marks the DM channel's explainer, so the bot finds and updates its own copy instead of posting another. */
export const INTRO_FOOTER = 'DEADLINE // CHATS';

/** The pinned post at the top of the DM channel: what it's for and how chats work. */
export function chatIntroMessage(url: string): MessageCreateOptions & { embeds: APIEmbed[] } {
    return {
        embeds: [
            {
                color: SITE.cyan,
                title: 'Chats between characters',
                description:
                    'Every chat on Deadline gets a private thread here. You only see the ones your characters are in: direct chats, groups, your crews and the gigs you are on.',
                fields: [
                    {
                        name: 'Talking',
                        value: "Type in a thread and it's posted as your character, on Discord and the web. With more than one character in a chat you're asked once which is speaking. `/dm as` switches, `/dm say` sends one message as another.",
                    },
                    { name: 'Starting a chat', value: "`/dm new`, or **Message** on someone's page on the web. `/dm add` and `/dm leave` work in group chats." },
                    { name: 'Editing', value: 'Right-click your message, then **Apps** for **Edit message** or **Delete message**.' },
                ],
                footer: { text: INTRO_FOOTER },
            },
        ],
        components: [
            {
                type: ComponentType.ActionRow,
                components: [
                    { type: ComponentType.Button, style: ButtonStyle.Link, label: 'Messages on the web', url: `${url}/messages` },
                    { type: ComponentType.Button, style: ButtonStyle.Link, label: 'Notification settings', url: `${url}/me` },
                ],
            },
        ],
        allowedMentions: { parse: [] },
    };
}
