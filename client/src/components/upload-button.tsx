import { Upload } from 'lucide-react';
import { type ChangeEvent, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CropDialog } from '@/components/crop-dialog';
import { Button } from '@/components/ui/button';
import { type UploadOptions, uploadImage } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * The one way pictures get uploaded: an Upload button with a hidden file picker. Each picked
 * file goes through the crop tool, then up, then `onUploaded` gets the new image IDs.
 * Cancelling skips the rest. Errors show as toasts.
 */
export function UploadButton({
    options,
    onUploaded,
    multiple = false,
    className,
}: {
    options?: UploadOptions;
    onUploaded: (ids: number[]) => void | Promise<void>;
    multiple?: boolean;
    className?: string;
}) {
    const input = useRef<HTMLInputElement>(null);
    const [queue, setQueue] = useState<File[]>([]);
    const [index, setIndex] = useState(0);
    const [ids, setIds] = useState<number[]>([]);
    const [uploading, setUploading] = useState(false);

    const pick = (e: ChangeEvent<HTMLInputElement>) => {
        const files = [...(e.target.files ?? [])];
        e.target.value = '';
        setQueue(files);
        setIndex(0);
        setIds([]);
    };

    // Whatever made it up still counts, even if the rest was cancelled or failed
    const finish = async (done: number[]) => {
        setQueue([]);
        if (done.length) await onUploaded(done);
    };

    const upload = async (picture: Blob) => {
        const file = queue[index];
        setUploading(true);
        let done = ids;
        try {
            const named = picture instanceof File ? picture : new File([picture], file.name, { type: picture.type });
            done = [...ids, await uploadImage(named, options)];
            setIds(done);
        } catch (err) {
            toast.error((err as Error).message);
            setUploading(false);
            return finish(done);
        }
        setUploading(false);
        if (index + 1 < queue.length) setIndex(index + 1);
        else await finish(done);
    };

    return (
        <>
            <Button type="button" variant="outline" size="sm" className={cn(className)} disabled={uploading} onClick={() => input.current?.click()}>
                <Upload className="size-4" /> {uploading ? 'Uploading' : 'Upload'}
            </Button>
            <input ref={input} type="file" accept="image/*" multiple={multiple} hidden onChange={pick} />
            <CropDialog
                file={uploading ? null : (queue[index] ?? null)}
                kind={options?.kind ?? 'gig'}
                step={queue.length > 1 ? `${index + 1} of ${queue.length}` : undefined}
                onDone={upload}
                onCancel={() => finish(ids)}
            />
        </>
    );
}
