import { frameSvg, VARIANTS, variantIndex } from '@shared/frame';
import { SIZES } from '@shared/images';
import { useState } from 'react';
import { toast } from 'sonner';
import { plainImageUrl } from '@/lib/api';
import { cn } from '@/lib/utils';

const svgUrl = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
const { width, height } = SIZES.avatar;

/**
 * The frames a square picture can have, each drawn over it the way the server renders them.
 * Picking one asks `copy` for the picture in that frame (a new image ID) and hands it to
 * `onChange`. Copies already made are remembered, so going back to one doesn't make another.
 */
export function FramePicker({ imageId, copy, onChange, disabled }: { imageId: string; copy: (variant: number) => Promise<string>; onChange: (imageId: string) => void; disabled?: boolean }) {
    const [copies, setCopies] = useState<Record<number, string>>({ [variantIndex(imageId)]: imageId });
    const [busy, setBusy] = useState<number | null>(null);
    // A new upload starts over
    const known = Object.values(copies).includes(imageId) ? copies : { [variantIndex(imageId)]: imageId };
    const current = variantIndex(imageId);

    const pick = async (variant: number) => {
        if (variant === current) return;
        if (known[variant]) return onChange(known[variant]);
        setBusy(variant);
        try {
            const id = await copy(variant);
            setCopies({ ...known, [variant]: id });
            onChange(id);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "couldn't change the frame.");
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="grid grid-cols-6 gap-1.5">
            {VARIANTS.map((variant, i) => {
                const { overlay, mask } = frameSvg(width, height, { variant, padded: false });
                return (
                    <button
                        key={i}
                        type="button"
                        title={`Frame ${i + 1}`}
                        aria-pressed={i === current}
                        disabled={disabled || busy !== null}
                        onClick={() => void pick(i)}
                        className={cn(
                            'relative aspect-square cursor-pointer outline-2 outline-offset-2 outline-transparent disabled:cursor-wait',
                            i === current ? 'outline-primary' : 'opacity-70 hover:opacity-100 hover:outline-border',
                            busy === i && 'animate-pulse',
                        )}
                    >
                        <img
                            src={plainImageUrl(imageId)}
                            alt=""
                            loading="lazy"
                            className="absolute inset-0 size-full"
                            style={{ maskImage: svgUrl(mask), WebkitMaskImage: svgUrl(mask), maskSize: '100% 100%', WebkitMaskSize: '100% 100%' }}
                        />
                        <img src={`data:image/svg+xml,${encodeURIComponent(overlay)}`} alt="" className="absolute inset-0 size-full" />
                    </button>
                );
            })}
        </div>
    );
}
