import type { RetireInput, RunnerView } from '@shared/schemas';
import { useState } from 'react';
import { ConfirmButton } from '@/components/common';
import { MarkdownEditor } from '@/components/markdown';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/input';
import { api, useAction } from '@/lib/api';
import { cn } from '@/lib/utils';

const MESSAGES: Record<RetireInput['status'], string> = { active: 'back on the board.', retired: 'retired.', dead: 'flatlined.' };

/**
 * Retiring a runner or marking them flatlined, for their player and admins. Retired runners
 * can come back; only admins can bring back the dead. Either way out takes them off live gigs.
 */
export function RetireControls({ runner, isAdmin }: { runner: RunnerView; isAdmin: boolean }) {
    const save = useAction(
        (body: RetireInput) => api(`/api/runners/${runner.id}/status`, 'POST', body).then(() => body.status),
        (status) => MESSAGES[status],
    );

    if (runner.status === 'dead') {
        return (
            <>
                <RetireDialog runner={runner} only="dead" label="Edit obituary" onSave={save.mutate} busy={save.isPending} />
                {isAdmin && (
                    <ConfirmButton
                        size="sm"
                        variant="default"
                        label="Bring back"
                        title={`Bring ${runner.handle} back?`}
                        description="Undoes the flatline and drops the obituary. They can take gigs again."
                        onConfirm={() => save.mutate({ status: 'active' })}
                    />
                )}
            </>
        );
    }
    if (runner.status === 'retired') {
        return (
            <>
                <ConfirmButton
                    size="sm"
                    variant="default"
                    label="Bring back"
                    title={`Bring ${runner.handle} back?`}
                    description="They're back under Active and can take gigs again."
                    onConfirm={() => save.mutate({ status: 'active' })}
                />
                <RetireDialog runner={runner} only="dead" label="Flatline" onSave={save.mutate} busy={save.isPending} />
            </>
        );
    }
    return <RetireDialog runner={runner} label="Retire" onSave={save.mutate} busy={save.isPending} />;
}

/** Picks retired or flatlined (or just flatlined, with `only`), with an obituary for the dead. */
function RetireDialog({ runner, only, label, onSave, busy }: { runner: RunnerView; only?: 'dead'; label: string; onSave: (body: RetireInput) => void; busy: boolean }) {
    const [open, setOpen] = useState(false);
    const [status, setStatus] = useState<'retired' | 'dead'>(only ?? 'retired');
    const [obituary, setObituary] = useState(runner.obituary ?? '');

    const submit = () => {
        onSave(status === 'dead' ? { status, obituary: obituary.trim() || null } : { status });
        setOpen(false);
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(o) => {
                setOpen(o);
                if (o) {
                    setStatus(only ?? 'retired');
                    setObituary(runner.obituary ?? '');
                }
            }}
        >
            <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                    {label}
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
                <DialogTitle>{runner.status === 'dead' ? `${runner.handle}'s obituary` : `${status === 'dead' ? 'Flatline' : 'Retire'} ${runner.handle}?`}</DialogTitle>
                <DialogDescription>
                    {runner.status === 'active'
                        ? "They're taken off any live gigs and move to the Retired tab. Finished gigs keep the record."
                        : runner.status === 'retired'
                          ? 'Flatlined is for good. Their obituary shows on their profile.'
                          : 'Shown on their profile.'}
                </DialogDescription>

                {!only && (
                    <div className="mt-4 grid grid-cols-2 gap-2">
                        <Choice active={status === 'retired'} onClick={() => setStatus('retired')} title="Retired" hint="hung up their gear. can come back." />
                        <Choice active={status === 'dead'} onClick={() => setStatus('dead')} title="Flatlined" hint="dead. gone for good." danger />
                    </div>
                )}

                {status === 'dead' && (
                    <div className="mt-4 space-y-1">
                        <Label>Obituary</Label>
                        <MarkdownEditor value={obituary} onChange={setObituary} max={4000} />
                    </div>
                )}

                <div className="mt-6 flex justify-end gap-2">
                    <DialogClose asChild>
                        <Button variant="ghost">Back</Button>
                    </DialogClose>
                    <Button variant={status === 'dead' && runner.status !== 'dead' ? 'destructive' : 'default'} disabled={busy} onClick={submit}>
                        {runner.status === 'dead' ? 'Save' : status === 'dead' ? 'Flatline' : 'Retire'}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

function Choice({ active, onClick, title, hint, danger }: { active: boolean; onClick: () => void; title: string; hint: string; danger?: boolean }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={cn(
                'cut-frame flex cursor-pointer flex-col justify-start p-3 text-left [--cut:10px]',
                active ? (danger ? '[--fill:color-mix(in_oklab,var(--color-destructive)_20%,transparent)] [--frame:var(--color-destructive)]' : '[--fill:color-mix(in_oklab,var(--color-primary)_15%,transparent)] [--frame:var(--color-primary)]') : '[--frame:var(--color-border)] hover:[--fill:var(--color-muted)]',
            )}
        >
            <span className={cn('block font-display tracking-wider uppercase', active && (danger ? 'text-destructive' : 'text-primary'))}>{title}</span>
            <span className="text-xs text-muted-foreground">{hint}</span>
        </button>
    );
}
