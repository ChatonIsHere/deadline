import { Body, Controller, Delete, Get, Headers, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { type Me, pushEndpointInput, pushSubscriptionInput, type PushSubscriptionInput } from '../shared/schemas';
import { ZodPipe } from '../zod.pipe';
import { PushService } from './push.service';

@Controller('api/push')
@UseGuards(AuthGuard)
export class PushController {
    constructor(private readonly push: PushService) {}

    /** The key browsers subscribe with. Null when push is off on this server. */
    @Get('key')
    key() {
        return { key: this.push.publicKey() };
    }

    @Post('subscriptions')
    @HttpCode(204)
    async subscribe(@CurrentUser() user: Me, @Body(new ZodPipe(pushSubscriptionInput)) body: PushSubscriptionInput, @Headers('user-agent') userAgent?: string) {
        await this.push.subscribe(user.id, body, userAgent);
    }

    @Delete('subscriptions')
    @HttpCode(204)
    async unsubscribe(@CurrentUser() user: Me, @Body(new ZodPipe(pushEndpointInput)) body: { endpoint: string }) {
        await this.push.unsubscribe(user.id, body.endpoint);
    }
}
