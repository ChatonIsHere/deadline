import { Logger } from '@nestjs/common';
import { ApplicationFlags, GatewayIntentBits } from 'discord.js';
import { config } from '../config';

/**
 * What the bot listens to. Message Content (the words of messages typed in chats' threads)
 * is privileged: logging in asking for it without it turned on in the developer portal fails,
 * and the bot would never start. So the app's settings are checked first, and without it
 * chats still work from the web; typed Discord messages just don't come across.
 */
export async function botIntents(): Promise<GatewayIntentBits[]> {
    const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMessageTyping];
    const logger = new Logger('Intents');
    try {
        const res = await fetch('https://discord.com/api/v10/applications/@me', { headers: { Authorization: `Bot ${config.DISCORD_TOKEN}` } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { flags = 0 } = (await res.json()) as { flags?: number };
        if (flags & (ApplicationFlags.GatewayMessageContent | ApplicationFlags.GatewayMessageContentLimited)) intents.push(GatewayIntentBits.MessageContent);
        else logger.warn('Message Content intent is off in the developer portal: messages typed in chat threads will not reach the web.');
    } catch (err) {
        logger.warn(`Couldn't check the app's intents (${(err as Error).message}), so leaving Message Content out.`);
    }
    return intents;
}
