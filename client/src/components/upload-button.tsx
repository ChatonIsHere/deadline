import { MAX_UPLOAD } from '@shared/images';
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
 * Cancelling skips the rest. Errors show as toasts. Art keeps its shape, so it skips the crop.
 */
export function UploadButton({
    options,
    onUploaded,
    multiple = false,
    limit,
    className,
}: {
    options?: UploadOptions;
    onUploaded: (ids: string[]) => void | Promise<void>;
    multiple?: boolean;
    /** Most files to take at once. Art only: there's room for this many more. */
    limit?: number;
    className?: string;
}) {
    const input = useRef<HTMLInputElement>(null);
    const [queue, setQueue] = useState<File[]>([]);
    const [index, setIndex] = useState(0);
    const [ids, setIds] = useState<string[]>([]);
    const [uploading, setUploading] = useState(false);

    const pick = (e: ChangeEvent<HTMLInputElement>) => {
        const files = [...(e.target.files ?? [])];
        e.target.value = '';
        if (options?.kind === 'art') {
            void uploadArt(files);
            return;
        }
        setQueue(files);
        setIndex(0);
        setIds([]);
    };

    // Whatever made it up still counts, even if the rest was cancelled or failed
    const finish = async (done: string[]) => {
        setQueue([]);
        if (!done.length) return;
        toast.success(done.length === 1 ? 'picture uploaded.' : `${done.length} pictures uploaded.`);
        await onUploaded(done);
    };

    const uploadArt = async (files: File[]) => {
        const picked = limit === undefined ? files : files.slice(0, limit);
        if (picked.length < files.length) toast.error(`only room for ${limit} more.`);
        const fit = picked.filter((f) => f.size <= MAX_UPLOAD);
        if (fit.length < picked.length) toast.error(`too big, so left out: over ${MAX_UPLOAD / 1024 / 1024} MB.`);
        if (!fit.length) return;
        setUploading(true);
        // Whatever made it up still counts
        const done: string[] = [];
        try {
            for (const file of fit) done.push(await uploadImage(file, options));
        } catch (err) {
            toast.error((err as Error).message);
        }
        setUploading(false);
        await finish(done);
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
                kind={options?.kind === 'avatar' ? 'avatar' : 'gig'}
                step={queue.length > 1 ? `${index + 1} of ${queue.length}` : undefined}
                onDone={upload}
                onCancel={() => finish(ids)}
            />
        </>
    );
}
