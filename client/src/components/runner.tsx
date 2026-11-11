import { CORE_ROLES, type Rating, type RunnerCard } from '@shared/schemas';
import { Star } from 'lucide-react';
import { Link } from 'react-router';
import { Icon, LinkCard } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { imageUrl, mediumUrl, thumbUrl } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * A runner's picture. Small sizes use the plain picture with cut corners (the frame
 * would be lost); `framed` shows the full framed picture for profiles. `large` is for sizes the
 * thumbnail would look soft at.
 */
export function RunnerAvatar({ runner, framed, large, className }: { runner: Pick<RunnerCard, 'handle' | 'imageId'>; framed?: boolean; large?: boolean; className?: string }) {
    if (!runner.imageId) {
        return (
            <span className={cn('cut grid size-6 shrink-0 place-items-center bg-muted font-display text-xs text-primary [--cut:4px]', className)}>
                {runner.handle[0]?.toUpperCase()}
            </span>
        );
    }
    return framed ? (
        <img src={imageUrl(runner.imageId)} alt="" loading="lazy" className={cn('aspect-square shrink-0', className)} />
    ) : (
        <img src={large ? mediumUrl(runner.imageId) : thumbUrl(runner.imageId)} alt="" loading="lazy" className={cn('cut size-6 shrink-0 object-cover [--cut:4px]', className)} />
    );
}

/** A runner's picture and handle, linking to their profile. */
export function RunnerChip({ runner }: { runner: RunnerCard }) {
    const inner = (
        <>
            <RunnerAvatar runner={runner} />
            {runner.handle}
        </>
    );
    // Deleted runners (id 0) have no profile
    return runner.id ? (
        <Link to={`/runners/${runner.slug || runner.id}`} className="inline-flex items-center gap-2 align-middle text-accent hover:underline">
            {inner}
        </Link>
    ) : (
        <span className="inline-flex items-center gap-2 align-middle text-muted-foreground">{inner}</span>
    );
}

/**
 * A runner's card in a grid (Runners tab, crew pages): picture, handle and roles, linking to
 * their profile. Retired and flatlined runners are greyed out and say so. The picture has room
 * beside it for four lines. `compact` is for narrow spots like a crew's member list: just a
 * smaller picture, the handle and roles, at a set height so a list of them lines up. On phones
 * the normal card shrinks to a mini card, matching a fixer's.
 */
export function RunnerTile({ runner, compact }: { runner: RunnerCard; compact?: boolean }) {
    const gone = runner.status !== 'active';
    return (
        <LinkCard to={`/runners/${runner.slug}`} className={cn('flex items-start', compact ? 'h-29 gap-3' : 'gap-3 p-3 md:gap-4 md:p-4')}>
            <RunnerAvatar runner={runner} large={!compact} className={cn(compact ? 'size-20 text-3xl [--cut:10px]' : 'size-24 text-4xl [--cut:12px] md:size-28', gone && 'opacity-60 grayscale')} />
            {/*
              * The name stays put whatever's under it. Normal cards: where it'd be, centred, above one
              * row of roles and two lines of tagline. Compact: the height is exactly name plus two rows
              * of roles, so any more roles than that drop off a whole row at a time.
              */}
            <div className={cn('min-w-0', compact ? 'h-20 space-y-1 overflow-hidden' : 'space-y-1 md:space-y-1.5 md:pt-2.5')}>
                <h3 className={cn('truncate', compact ? 'text-base leading-7' : 'text-lg', gone && 'text-muted-foreground')}>{runner.handle}</h3>
                {gone ? <RunnerStatusTag status={runner.status} /> : <Roles runner={runner} />}
                {!compact && runner.tagline && <p className="line-clamp-2 text-xs text-muted-foreground">{runner.tagline}</p>}
            </div>
        </LinkCard>
    );
}

/** "Retired" or "Flatlined", for runners who don't take gigs any more. */
export function RunnerStatusTag({ status, className }: { status: RunnerCard['status']; className?: string }) {
    if (status === 'active') return null;
    return (
        <span className={cn('block font-display text-xs tracking-widest uppercase', status === 'dead' ? 'text-destructive' : 'text-muted-foreground', className)}>
            {status === 'dead' ? 'Flatlined' : 'Retired'}
        </span>
    );
}

/** The bot's icon for one of RED's core roles. Roles added in Settings have none. */
export function RoleIcon({ role, className }: { role: string; className?: string }) {
    return CORE_ROLES.includes(role) ? <Icon name={`role_${role.toLowerCase()}`} className={className} /> : null;
}

/**
 * A runner's main role as a pink tag with its icon. `small` fits it in a list row beside their
 * name; there the name cuts short last.
 */
export function RoleTag({ role, small, className }: { role: string; small?: boolean; className?: string }) {
    return (
        <Badge variant="role" className={cn('gap-1', small && 'min-w-0 px-1.5 py-0 text-[10px] leading-4 [--cut:4px]', className)}>
            <RoleIcon role={role} className={small ? 'size-3 shrink-0' : 'size-3.5 align-[-2px]'} />
            {small ? <span className="truncate">{role}</span> : role}
        </Badge>
    );
}

/** Main role first, then any extras, fainter, each with its icon. Pink tints, since filled colours mean a gig's status. */
export function Roles({ runner, className }: { runner: Pick<RunnerCard, 'role' | 'extraRoles'>; className?: string }) {
    return (
        <span className={cn('inline-flex flex-wrap gap-1', className)}>
            <RoleTag role={runner.role} />
            {runner.extraRoles.map((r) => (
                <Badge key={r} variant="role" className="gap-1 bg-role/15 text-foreground/80">
                    <RoleIcon role={r} className="size-3.5 align-[-2px] opacity-80" />
                    {r}
                </Badge>
            ))}
        </span>
    );
}

export function Stars({ value, className }: { value: number; className?: string }) {
    return (
        <span className={cn('inline-flex text-primary', className)} aria-label={`${value} of 5 stars`}>
            {[1, 2, 3, 4, 5].map((n) => (
                <Star key={n} className={cn('size-4', n <= Math.round(value) ? 'fill-current' : 'opacity-30')} />
            ))}
        </span>
    );
}

/** Stars and the average. `count` adds how many ratings that's from. */
export function RatingLine({ rating, count = true, className }: { rating: Rating; count?: boolean; className?: string }) {
    if (!rating.average) return <span className="text-xs text-muted-foreground">no ratings yet</span>;
    return (
        <span className={cn('inline-flex items-center gap-2', className)}>
            <Stars value={rating.average} />
            <span className="text-xs text-muted-foreground">
                {rating.average.toFixed(1)}
                {count && ` · ${rating.count} rating${rating.count === 1 ? '' : 's'}`}
            </span>
        </span>
    );
}

/** Clickable stars for rating a fixer. */
export function StarPicker({ value, onPick, disabled }: { value: number | null; onPick: (stars: number) => void; disabled?: boolean }) {
    return (
        <span className="inline-flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
                <button
                    key={n}
                    type="button"
                    disabled={disabled}
                    title={`${n} star${n === 1 ? '' : 's'}`}
                    onClick={() => onPick(n)}
                    className="cursor-pointer text-primary disabled:cursor-default"
                >
                    <Star className={cn('size-6', value && n <= value ? 'fill-current' : 'opacity-40 hover:opacity-80')} />
                </button>
            ))}
        </span>
    );
}
