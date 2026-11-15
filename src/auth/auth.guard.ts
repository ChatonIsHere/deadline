import { CanActivate, createParamDecorator, ExecutionContext, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { config } from '../config';
import { Window } from '../limits';
import type { Me } from '../shared/schemas';
import { AuthService } from './auth.service';

export const SESSION_COOKIE = 'deadline_session';

type AuthedRequest = Request & { user?: Me };

/** Changes in the last minute, per person, for MAX_WRITES_PER_MINUTE. */
const writes = new Window(60_000);

/** Lets signed in users through and puts them on the request. Anything but reading counts toward the write limit. */
@Injectable()
export class AuthGuard implements CanActivate {
    constructor(private readonly auth: AuthService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const req = context.switchToHttp().getRequest<AuthedRequest>();
        const user = await this.auth.user(req.cookies?.[SESSION_COOKIE]);
        if (!user) throw new UnauthorizedException();
        req.user = user;
        const max = config.MAX_WRITES_PER_MINUTE;
        if (max && req.method !== 'GET' && !user.isAdmin && writes.hit(user.id) >= max) {
            throw new HttpException('slow down: too many changes in a minute. try again shortly.', HttpStatus.TOO_MANY_REQUESTS);
        }
        return true;
    }
}

/** The signed in user. Only use behind AuthGuard. */
export const CurrentUser = createParamDecorator((_: unknown, context: ExecutionContext) => {
    return context.switchToHttp().getRequest<AuthedRequest>().user!;
});
