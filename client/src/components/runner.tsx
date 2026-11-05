import { CORE_ROLES, type Rating, type RunnerCard } from '@shared/schemas';
import { Star } from 'lucide-react';
import { Link } from 'react-router';
import { Icon } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { imageUrl, plainImageUrl } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * A runner's picture. Small sizes use the plain picture with cut corners (the frame
 * would be lost); `framed` shows the full framed picture for profiles.
 */
export function RunnerAvatar({ runner, framed, className }: { runner: Pick<RunnerCard, 'handle' | 'imageId'>; framed?: boolean; className?: string }) {
    if (!runner.imageId) {
        return (
            <span className={cn('cut grid size-6 shrink-0 place-items-center bg-muted font-display text-xs text-primary [--cut:4px]', className)}>
                {runner.handle[0]?.toUpperCase()}
            </span>
        );
    }
    return framed ? (
        <img src={imageUrl(runner.imageId)} alt="" className={cn('aspect-square shrink-0', className)} />
    ) : (
        <img src={plainImageUrl(runner.imageId)} alt="" className={cn('cut size-6 shrink-0 object-cover [--cut:4px]', className)} />
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
        <Link to={`/runners/${runner.slug || runner.id}`} className="inline-flex items-center gap-2 align-middle hover:text-primary">
            {inner}
        </Link>
    ) : (
        <span className="inline-flex items-center gap-2 align-middle text-muted-foreground">{inner}</span>
    );
}

/** The bot's icon for one of RED's core roles. Roles added in Settings have none. */
export function RoleIcon({ role, className }: { role: string; className?: string }) {
    return CORE_ROLES.includes(role) ? <Icon name={`role_${role.toLowerCase()}`} className={className} /> : null;
}

/** Main role first, then any extras. */
export function Roles({ runner, className }: { runner: Pick<RunnerCard, 'role' | 'extraRoles'>; className?: string }) {
    return (
        <span className={cn('inline-flex flex-wrap gap-1', className)}>
            <Badge>{runner.role}</Badge>
            {runner.extraRoles.map((r) => (
                <Badge key={r} variant="muted">
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

export function RatingLine({ rating }: { rating: Rating }) {
    if (!rating.average) return <span className="text-xs text-muted-foreground">no ratings yet</span>;
    return (
        <span className="inline-flex items-center gap-2">
            <Stars value={rating.average} />
            <span className="text-xs text-muted-foreground">
                {rating.average.toFixed(1)} · {rating.count} rating{rating.count === 1 ? '' : 's'}
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
