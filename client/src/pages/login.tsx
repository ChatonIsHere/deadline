import { useSearchParams } from 'react-router';
import { Say } from '@/components/common';
import { Button } from '@/components/ui/button';

const ERRORS: Record<string, string> = {
    denied: 'access denied. you need a role on the server to see the board.',
    failed: 'handshake failed. try again.',
    state: 'handshake timed out. try again.',
};

export function Login() {
    const error = useSearchParams()[0].get('error');
    return (
        // Centred. On phones it's worked out and rounded rather than left to flexbox: centring can put
        // the box's top edge on part of a pixel, and Firefox on phones can drop a 1px line there
        <div className="flex min-h-dvh justify-center px-4 pb-4 max-md:pt-[round(down,calc(50dvh-9rem),1px)] md:items-center md:pt-4">
            <div className="cut-frame h-fit w-full max-w-md space-y-6 p-8 [--frame:var(--color-primary)]">
                <div className="flex items-center gap-3">
                    <img src="/logo.svg" alt="" className="size-12" />
                    <h1 className="text-3xl tracking-[0.25em] text-primary">Deadline</h1>
                </div>
                <div className="space-y-1">
                    <Say>fixer board node online.</Say>
                    <Say>authenticate to view contracts.</Say>
                    {error && <Say className="text-destructive">{ERRORS[error] ?? ERRORS.failed}</Say>}
                </div>
                <Button asChild className="w-full">
                    <a href="/auth/login">Jack in with Discord</a>
                </Button>
            </div>
        </div>
    );
}
