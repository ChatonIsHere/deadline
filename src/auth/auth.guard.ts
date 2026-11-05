import { CanActivate, createParamDecorator, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { Me } from '../shared/schemas';
import { AuthService } from './auth.service';

export const SESSION_COOKIE = 'deadline_session';

type AuthedRequest = Request & { user?: Me };

/** Lets signed in users through and puts them on the request. */
@Injectable()
export class AuthGuard implements CanActivate {
    constructor(private readonly auth: AuthService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const req = context.switchToHttp().getRequest<AuthedRequest>();
        const user = await this.auth.user(req.cookies?.[SESSION_COOKIE]);
        if (!user) throw new UnauthorizedException();
        req.user = user;
        return true;
    }
}

/** The signed in user. Only use behind AuthGuard. */
export const CurrentUser = createParamDecorator((_: unknown, context: ExecutionContext) => {
    return context.switchToHttp().getRequest<AuthedRequest>().user!;
});
