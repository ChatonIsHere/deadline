import { Upload } from 'lucide-react';
import { type ChangeEvent, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { type UploadOptions, uploadImage } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * The one way pictures get uploaded: an Upload button with a hidden file picker. Each
 * picked file is uploaded, then `onUploaded` gets the new image IDs. Errors show as toasts.
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
    const [uploading, setUploading] = useState(false);

    const upload = async (e: ChangeEvent<HTMLInputElement>) => {
        const files = [...(e.target.files ?? [])];
        e.target.value = '';
        if (!files.length) return;
        setUploading(true);
        const ids: number[] = [];
        try {
            for (const file of files) ids.push(await uploadImage(file, options));
        } catch (err) {
            toast.error((err as Error).message);
        } finally {
            setUploading(false);
        }
        // Whatever made it up before an error still counts
        if (ids.length) await onUploaded(ids);
    };

    return (
        <>
            <Button type="button" variant="outline" size="sm" className={cn(className)} disabled={uploading} onClick={() => input.current?.click()}>
                <Upload className="size-4" /> {uploading ? 'Uploading' : 'Upload'}
            </Button>
            <input ref={input} type="file" accept="image/*" multiple={multiple} hidden onChange={upload} />
        </>
    );
}
