import { MAX_ART } from '@shared/images';
import { X } from 'lucide-react';
import { useState } from 'react';
import { Card, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { UploadButton } from '@/components/upload-button';
import { artPreviewUrl, artThumbUrl, artUrl } from '@/lib/api';
import { cn } from '@/lib/utils';

/** Picking a runner's gallery on their edit form. */
export function ArtField({ value, onChange }: { value: string[]; onChange: (artIds: string[]) => void }) {
    const room = MAX_ART - value.length;
    return (
        <Card className="space-y-3">
            <CardTitle help={`up to ${MAX_ART} pictures, any shape, 15 MB each. they're scaled to 2000px on the longest side and compressed. the first one shows first.`}>Gallery</CardTitle>
            {value.length > 0 && (
                <div className="grid grid-cols-3 gap-1.5">
                    {value.map((id) => (
                        <div key={id} className="relative">
                            <img src={artThumbUrl(id)} alt="" className="aspect-square w-full object-cover" />
                            <button
                                type="button"
                                aria-label="Remove picture"
                                onClick={() => onChange(value.filter((other) => other !== id))}
                                className="absolute top-0 right-0 grid size-5 cursor-pointer place-items-center bg-background/85 text-foreground hover:text-destructive"
                            >
                                <X className="size-3.5" />
                            </button>
                        </div>
                    ))}
                </div>
            )}
            {room > 0 && <UploadButton className="w-full" multiple limit={room} options={{ kind: 'art' }} onUploaded={(ids) => onChange([...value, ...ids])} />}
            <p className="text-xs text-muted-foreground">
                {value.length}/{MAX_ART} pictures
            </p>
        </Card>
    );
}

/** A runner's gallery on their profile: one big picture, which opens full size, and a row to pick from. */
export function ArtGallery({ artIds, name, gone }: { artIds: string[]; name: string; gone?: boolean }) {
    const [picked, setPicked] = useState(0);
    // Pictures can go while the page is open
    const index = Math.min(picked, artIds.length - 1);
    const shown = artIds[index];
    const fade = gone && 'grayscale';

    return (
        <Card className="space-y-3 [--frame:var(--color-accent)]">
            <CardTitle>Gallery</CardTitle>
            <Dialog>
                <DialogTrigger asChild>
                    <button
                        type="button"
                        aria-label={`Full size picture of ${name}`}
                        className="cut-frame block w-full cursor-zoom-in p-1 [--cut:14px] [--fill:var(--color-background)] [--frame:var(--color-primary)]"
                    >
                        {/* A fixed shape, so changing picture doesn't move the page */}
                        <img src={artPreviewUrl(shown)} alt="" className={cn('aspect-[3/4] w-full object-contain', fade)} />
                    </button>
                </DialogTrigger>
                <DialogContent className="max-w-[95vw] sm:max-w-fit">
                    <DialogTitle className="sr-only">{name}</DialogTitle>
                    <DialogDescription className="sr-only">Full size picture</DialogDescription>
                    <img src={artUrl(shown)} alt="" className={cn('mx-auto max-h-[85vh] max-w-full object-contain', fade)} />
                </DialogContent>
            </Dialog>
            {artIds.length > 1 && (
                <div className="grid grid-cols-4 gap-2">
                    {artIds.map((id, i) => (
                        <button
                            key={id}
                            type="button"
                            aria-label={`Picture ${i + 1} of ${artIds.length}`}
                            aria-pressed={i === index}
                            onClick={() => setPicked(i)}
                            className={cn(
                                'cut-frame cursor-pointer p-0.5 [--cut:8px] [--fill:var(--color-background)]',
                                i === index ? '[--frame:var(--color-primary)]' : 'opacity-70 hover:opacity-100 hover:[--frame:var(--color-accent)]',
                            )}
                        >
                            <img src={artThumbUrl(id)} alt="" loading="lazy" className={cn('aspect-square w-full object-cover', fade)} />
                        </button>
                    ))}
                </div>
            )}
        </Card>
    );
}
