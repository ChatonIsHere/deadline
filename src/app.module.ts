import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { NecordModule } from 'necord';
import { AuthController } from './auth/auth.controller';
import { AvailabilityController } from './availability/availability.controller';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { PrefsService } from './auth/prefs.service';
import { config } from './config';
import { ChatsController } from './chats/chats.controller';
import { ChatsService } from './chats/chats.service';
import { CrewsController } from './crews/crews.controller';
import { CrewsService } from './crews/crews.service';
import { CacheService } from './cache/cache.service';
import { CleanupService } from './library/cleanup.service';
import { ConfigController, ImagesController } from './library/images.controller';
import { LiveGateway } from './live/live.gateway';
import { LiveService } from './live/live.service';
import { PrismaService } from './prisma/prisma.service';
import { StorageService } from './storage/storage.service';
import { EmojiService } from './discord/emoji.service';
import { BotProfileService } from './discord/bot-profile.service';
import { ChatInteractions } from './discord/chat.interactions';
import { ChatRelayService } from './discord/chat-relay.service';
import { Commands } from './discord/commands';
import { botIntents } from './discord/intents';
import { CrewInteractions } from './discord/crew.interactions';
import { GigInteractions } from './discord/gig.interactions';
import { GigPostService } from './discord/gig-post.service';
import { MembersService } from './discord/members.service';
import { NotifyService } from './discord/notify.service';
import { SettingsController } from './settings/settings.controller';
import { SettingsService } from './settings/settings.service';
import { GigsController } from './gigs/gigs.controller';
import { GigsService } from './gigs/gigs.service';
import { LibraryController } from './library/library.controller';
import { LibraryService } from './library/library.service';
import { RunnersController } from './runners/runners.controller';
import { DowntimeService } from './runners/downtime.service';
import { RunnersService } from './runners/runners.service';
import { DebriefService } from './gigs/debrief.service';
import { LinkPreviewService } from './link-preview/link-preview.service';
import { PushController } from './push/push.controller';
import { PushService } from './push/push.service';

// One module. The app is small enough that splitting it up would only add files.
@Module({
    imports: [
        ScheduleModule.forRoot(),
        // Messages, their text and typing are for chats' threads (see botIntents)
        NecordModule.forRootAsync({ useFactory: async () => ({ token: config.DISCORD_TOKEN, intents: await botIntents() }) }),
    ],
    controllers: [AuthController, AvailabilityController, GigsController, CrewsController, SettingsController, LibraryController, RunnersController, ImagesController, ConfigController, ChatsController, PushController],
    providers: [
        LiveService,
        LiveGateway,
        PrismaService,
        // No arguments: they connect to REDIS_URL and S3 from the config (tests pass their own)
        { provide: CacheService, useFactory: () => new CacheService() },
        { provide: StorageService, useFactory: () => new StorageService() },
        CleanupService,
        AuthService,
        AuthGuard,
        PrefsService,
        SettingsService,
        LibraryService,
        MembersService,
        EmojiService,
        GigPostService,
        NotifyService,
        GigInteractions,
        CrewInteractions,
        Commands,
        BotProfileService,
        GigsService,
        DebriefService,
        DowntimeService,
        RunnersService,
        CrewsService,
        LinkPreviewService,
        PushService,
        ChatsService,
        ChatRelayService,
        ChatInteractions,
    ],
})
export class AppModule {}
