import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { UploadButton } from '@/components/upload-button';
import { artPreviewUrl, artUrl } from '@/lib/api';
import { cn } from '@/lib/utils';

/** Picking a runner's full art on their edit form. */
export function ArtField({ value, onChange }: { value: string | null; onChange: (artId: string | null) => void }) {
    return (
        <Card className="space-y-3">
            <CardTitle help="any shape, up to 15 MB. it's scaled to 2000px on the longest side and compressed.">Full art</CardTitle>
            {value && <img src={artPreviewUrl(value)} alt="" className="max-h-64 w-full object-contain" />}
            <div className="flex gap-2">
                <UploadButton className="flex-1" options={{ kind: 'art' }} onUploaded={([artId]) => onChange(artId)} />
                {value && (
                    <Button type="button" variant="ghost" size="icon" aria-label="Remove art" onClick={() => onChange(null)}>
                        <X className="size-4" />
                    </Button>
                )}
            </div>
        </Card>
    );
}

/** A runner's full art on their profile. Opens at full size. */
export function ArtPanel({ artId, name, gone }: { artId: string; name: string; gone?: boolean }) {
    const fade = gone && 'grayscale';
    return (
        <Dialog>
            <DialogTrigger asChild>
                <button type="button" className="block w-full cursor-zoom-in" aria-label={`Full art of ${name}`}>
                    <img src={artPreviewUrl(artId)} alt="" className={cn('max-h-[70vh] w-full object-contain', fade)} />
                </button>
            </DialogTrigger>
            <DialogContent className="max-w-[95vw] sm:max-w-fit">
                <DialogTitle className="sr-only">{name}</DialogTitle>
                <DialogDescription className="sr-only">Full art</DialogDescription>
                <img src={artUrl(artId)} alt="" className={cn('mx-auto max-h-[85vh] max-w-full object-contain', fade)} />
            </DialogContent>
        </Dialog>
    );
}
