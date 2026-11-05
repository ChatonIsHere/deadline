import { Module } from '@nestjs/common';
import { GatewayIntentBits } from 'discord.js';
import { NecordModule } from 'necord';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { PrefsService } from './auth/prefs.service';
import { config } from './config';
import { CrewsController } from './crews/crews.controller';
import { CrewsService } from './crews/crews.service';
import { DB, openDb } from './db/db';
import { EmojiService } from './discord/emoji.service';
import { BotProfileService } from './discord/bot-profile.service';
import { Commands } from './discord/commands';
import { CrewInteractions } from './discord/crew.interactions';
import { GigInteractions } from './discord/gig.interactions';
import { GigPostService } from './discord/gig-post.service';
import { MembersService } from './discord/members.service';
import { SettingsController } from './settings/settings.controller';
import { SettingsService } from './settings/settings.service';
import { GigsController } from './gigs/gigs.controller';
import { GigsService } from './gigs/gigs.service';
import { LibraryController } from './library/library.controller';
import { LibraryService } from './library/library.service';
import { RunnersController } from './runners/runners.controller';
import { RunnersService } from './runners/runners.service';
import { DebriefService } from './gigs/debrief.service';

// One module. The app is small enough that splitting it up would only add files.
@Module({
    imports: [
        NecordModule.forRoot({
            token: config.DISCORD_TOKEN,
            intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
        }),
    ],
    controllers: [AuthController, GigsController, CrewsController, SettingsController, LibraryController, RunnersController],
    providers: [
        { provide: DB, useFactory: () => openDb(config.DATABASE_PATH) },
        AuthService,
        AuthGuard,
        PrefsService,
        SettingsService,
        LibraryService,
        MembersService,
        EmojiService,
        GigPostService,
        GigInteractions,
        CrewInteractions,
        Commands,
        BotProfileService,
        GigsService,
        DebriefService,
        RunnersService,
        CrewsService,
    ],
})
export class AppModule {}
