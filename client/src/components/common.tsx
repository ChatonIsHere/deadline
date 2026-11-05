import type { GigStatus, Member } from '@shared/schemas';
import { type ReactNode, useState } from 'react';
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

export function Avatar({ member, className }: { member: Member; className?: string }) {
    return member.avatar ? (
        <img src={member.avatar} alt="" className={cn('cut size-6 shrink-0 [--cut:4px]', className)} />
    ) : (
        <span className={cn('cut grid size-6 shrink-0 place-items-center bg-muted text-xs [--cut:4px]', className)}>{member.name[0]}</span>
    );
}

export function Person({ member }: { member: Member }) {
    return (
        <span className="inline-flex items-center gap-2">
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

/** A line from the board's AI. */
export function Say({ children, className }: { children: ReactNode; className?: string }) {
    return (
        <p className={cn('text-muted-foreground', className)}>
            <span className="text-accent">// DEADLINE:</span> {children}
        </p>
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
}: {
    label: ReactNode;
    title: string;
    description: string;
    onConfirm: () => void;
    variant?: 'destructive' | 'default' | 'outline';
    size?: 'sm' | 'icon';
}) {
    const [open, setOpen] = useState(false);
    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant={variant === 'destructive' ? 'outline' : variant} size={size}>
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
