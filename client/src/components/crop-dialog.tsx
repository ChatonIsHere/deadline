import { type ImageKind, SIZES } from '@shared/images';
import { useEffect, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { Say } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

/**
 * Picks the part of a picture to keep, at the shape it's stored in (16:9 for gigs, square
 * for runners). Drag to move, pinch, scroll or use the slider to zoom. "Use as is" skips it
 * and the server takes the middle, as it always has.
 */
export function CropDialog({
    file,
    kind,
    step,
    onDone,
    onCancel,
}: {
    file: File | null;
    kind: ImageKind;
    /** "2 of 5", when several files are going up. */
    step?: string;
    onDone: (picture: Blob) => void;
    onCancel: () => void;
}) {
    const size = SIZES[kind];
    const [url, setUrl] = useState<string | null>(null);
    const [crop, setCrop] = useState({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [area, setArea] = useState<Area | null>(null);
    const [broken, setBroken] = useState(false);
    const [busy, setBusy] = useState(false);
    // The dialog's portal mounts a render later, so this is state rather than a ref
    const [box, setBox] = useState<HTMLDivElement | null>(null);
    const [settled, setSettled] = useState(false);

    // A fresh start for each file
    useEffect(() => {
        if (!file) return;
        const next = URL.createObjectURL(file);
        setUrl(next);
        setCrop({ x: 0, y: 0 });
        setZoom(1);
        setArea(null);
        setBroken(false);
        return () => URL.revokeObjectURL(next);
    }, [file]);

    // The cropper sizes its box from what it measures when the picture loads. While the dialog
    // is still opening it's squashed flat, which made a 0px box, so wait for that to finish.
    useEffect(() => {
        if (!box) return setSettled(false);
        let live = true;
        const opening = document.getAnimations().filter((a) => a.effect instanceof KeyframeEffect && a.effect.target instanceof Element && a.effect.target.contains(box));
        void Promise.allSettled(opening.map((a) => a.finished)).then(() => live && setSettled(true));
        return () => {
            live = false;
        };
    }, [box]);

    const cropIt = async () => {
        if (!file || !area) return;
        setBusy(true);
        try {
            onDone(await cropToBlob(file, area, size));
        } catch {
            // Couldn't draw it here: let the server have a go with the whole thing
            onDone(file);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open={!!file} onOpenChange={(open) => !open && onCancel()}>
            <DialogContent className="max-w-2xl space-y-4">
                <div>
                    <DialogTitle>Crop picture{step ? ` ${step}` : ''}</DialogTitle>
                    <DialogDescription>Drag to move it, zoom to get closer.</DialogDescription>
                </div>
                <div ref={setBox} className="relative h-64 bg-black sm:h-96">
                    {broken ? (
                        <div className="grid h-full place-items-center p-6">
                            <Say>can't preview that file here. upload it as is and the server will take the middle.</Say>
                        </div>
                    ) : (
                        url &&
                        settled && (
                            <Cropper
                                image={url}
                                crop={crop}
                                zoom={zoom}
                                maxZoom={4}
                                aspect={size.width / size.height}
                                onCropChange={setCrop}
                                onZoomChange={setZoom}
                                onCropComplete={(_, pixels) => setArea(pixels)}
                                mediaProps={{ onError: () => setBroken(true) }}
                                style={{ cropAreaStyle: { border: '2px solid var(--color-primary)', color: 'rgb(10 10 18 / 0.7)' } }}
                            />
                        )
                    )}
                </div>
                {!broken && (
                    <input
                        type="range"
                        min={1}
                        max={4}
                        step={0.01}
                        value={zoom}
                        onChange={(e) => setZoom(Number(e.target.value))}
                        aria-label="Zoom"
                        className="w-full accent-[var(--color-primary)]"
                    />
                )}
                <div className="flex flex-wrap justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button type="button" variant="outline" disabled={busy} onClick={() => file && onDone(file)}>
                        Use as is
                    </Button>
                    {!broken && (
                        <Button type="button" disabled={busy || !area} onClick={cropIt}>
                            Crop
                        </Button>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}

/**
 * Draws the kept part. Up to twice the stored size, so the server's resize (which is better
 * than a browser's) still does the final step. WebP where the browser can make it, else PNG.
 */
async function cropToBlob(file: File, area: Area, size: { width: number; height: number }): Promise<Blob> {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const width = Math.round(Math.min(area.width, size.width * 2));
    const height = Math.round((width * size.height) / size.width);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, area.x, area.y, area.width, area.height, 0, 0, width, height);
    bitmap.close();
    return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('crop failed'))), 'image/webp', 0.95));
}
