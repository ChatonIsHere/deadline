import { type GigStatus, type Member, payRange } from '@shared/schemas';
import { Popover } from 'radix-ui';
import { type ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/** One of the bot's emoji from assets/emoji. */
export function Icon({ name, className }: { name: string; className?: string }) {
    return <img src={`/emoji/${name}.svg`} alt="" className={cn('inline-block size-4 shrink-0 align-[-3px]', className)} />;
}

export function Money({ amount, className }: { amount: number; className?: string }) {
    return (
        <span className={cn('inline-flex items-center gap-1 font-semibold text-primary', className)}>
            <Icon name="eb" />
            {amount.toLocaleString('en-GB')}
        </span>
    );
}

/** A gig's pay: the primary objective alone, up to that plus every bonus. A + means per-each bonuses can take it higher. */
export function Pay({ gig, className }: { gig: Parameters<typeof payRange>[0]; className?: string }) {
    const { min, max, open } = payRange(gig);
    return (
        <span className={cn('inline-flex items-center gap-1 font-semibold text-primary', className)}>
            <Icon name="eb" />
            {min.toLocaleString('en-GB')}
            {max > min && ` – ${max.toLocaleString('en-GB')}`}
            {open && '+'}
        </span>
    );
}

export function Avatar({ member, className }: { member: Member; className?: string }) {
    return member.avatar ? (
        <img src={member.avatar} alt="" className={cn('cut size-6 shrink-0 [--cut:4px]', className)} />
    ) : (
        <span className={cn('cut grid size-6 shrink-0 place-items-center bg-muted text-xs [--cut:4px]', className)}>{member.name[0]}</span>
    );
}

export function Person({ member }: { member: Member }) {
    return (
        <span className="inline-flex items-center gap-2 align-middle">
            <Avatar member={member} />
            {member.name}
        </span>
    );
}

const STATUS_BADGE = {
    pending: 'muted',
    open: 'default',
    closed: 'accent',
    completed: 'success',
    cancelled: 'destructive',
    rejected: 'destructive',
} as const;

export function StatusBadge({ status }: { status: GigStatus }) {
    return <Badge variant={STATUS_BADGE[status]}>{status}</Badge>;
}

/**
 * A line from the board's AI, typed out quickly when it appears. Plain text only; anything
 * else just shows. The untyped rest is there but transparent, so nothing jumps around and
 * screen readers get the whole line.
 */
export function Say({ children, className }: { children: ReactNode; className?: string }) {
    const text = plainText(children);
    const shown = useTyped(text ?? '');
    const typing = text !== null && shown < text.length;
    return (
        // Always body size, so every line from the board matches wherever it sits
        <p className={cn('text-sm text-muted-foreground', className)}>
            <span className="text-accent">// DEADLINE:</span>{' '}
            {text === null ? (
                children
            ) : (
                <>
                    {text.slice(0, shown)}
                    {/* The cursor takes no room (its width is cancelled out), so lines don't rewrap while typing */}
                    {typing && <span className="-mr-[0.5em] inline-block h-[1em] w-[0.5em] translate-y-[0.15em] bg-accent" aria-hidden />}
                    <span className="text-transparent">{text.slice(shown)}</span>
                </>
            )}
        </p>
    );
}

/** Children as one string, or null if there's more than text in there. */
function plainText(children: ReactNode): string | null {
    const parts = Array.isArray(children) ? children : [children];
    return parts.every((p) => typeof p === 'string' || typeof p === 'number') ? parts.join('') : null;
}

/** How much of `text` to show. Types the whole thing in about a third of a second, or at once for people who turn motion off. */
function useTyped(text: string): number {
    const [shown, setShown] = useState(() => (prefersStill() ? text.length : 0));
    useEffect(() => {
        if (prefersStill()) return setShown(text.length);
        setShown(0);
        const perChar = Math.min(12, 350 / Math.max(text.length, 1));
        const start = performance.now();
        let frame = requestAnimationFrame(function step(now) {
            const n = Math.min(text.length, Math.ceil((now - start) / perChar));
            setShown(n);
            if (n < text.length) frame = requestAnimationFrame(step);
        });
        return () => cancelAnimationFrame(frame);
    }, [text]);
    return shown;
}

const prefersStill = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A cyan "?" that opens a short explanation from the board's AI, typed out like the rest. */
export function Help({ children, label = 'What is this?' }: { children: string; label?: string }) {
    return (
        <Popover.Root>
            <Popover.Trigger asChild>
                <button
                    type="button"
                    aria-label={label}
                    className="cut inline-grid size-5 shrink-0 cursor-pointer place-items-center bg-accent font-display text-xs leading-none font-bold text-accent-foreground outline-none [--cut:5px] hover:bg-accent/80 focus-visible:shadow-[inset_0_0_0_2px_var(--color-background)]"
                >
                    ?
                </button>
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content side="bottom" align="start" sideOffset={6} collisionPadding={16} className="z-50 w-72 max-w-[calc(100vw-2rem)]">
                    <div className="cut-frame p-3 text-xs [--cut:8px] [--frame:var(--color-accent)]">
                        <Say>{children}</Say>
                    </div>
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}

/** A button that asks before doing something hard to undo. */
export function ConfirmButton({
    label,
    title,
    description,
    onConfirm,
    variant = 'destructive',
    size,
    className,
}: {
    label: ReactNode;
    title: string;
    description: string;
    onConfirm: () => void;
    variant?: 'destructive' | 'default' | 'outline';
    size?: 'sm' | 'icon';
    className?: string;
}) {
    const [open, setOpen] = useState(false);
    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant={variant === 'destructive' ? 'outline' : variant} size={size} className={className}>
                    {label}
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogTitle>{title}</DialogTitle>
                <DialogDescription>{description}</DialogDescription>
                <div className="mt-6 flex justify-end gap-2">
                    <DialogClose asChild>
                        <Button variant="ghost">Back</Button>
                    </DialogClose>
                    <Button
                        variant={variant}
                        onClick={() => {
                            onConfirm();
                            setOpen(false);
                        }}
                    >
                        Confirm
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

/** A card that links somewhere, lighting up its frame on hover. */
export function LinkCard({ to, className, children }: { to: string; className?: string; children: ReactNode }) {
    return (
        <Link to={to} className={cn('cut-frame block p-4 outline-none hover:[--fill:var(--color-muted)] hover:[--frame:var(--color-primary)] focus-visible:[--fill:var(--color-muted)] focus-visible:[--frame:var(--color-accent)]', className)}>
            {children}
        </Link>
    );
}

/** Discord's logo, for links into the server. */
export function DiscordIcon({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={cn('size-4 shrink-0', className)}>
            <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
        </svg>
    );
}
