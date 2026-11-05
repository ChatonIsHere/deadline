import { isFreeSlugWord, SLUG_HINT, toSlug } from '@shared/slug';
import { Input, Label } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * The typed ID on a create form, as in /crews/static-wolves. It follows the name until
 * it's typed in by hand; `value` is undefined while it follows, and the server makes it
 * (adding -2 if the name's one is taken). It can't be changed later.
 */
export function SlugField({ id, name, base, value, onChange }: { id: string; name: string; base: string; value: string | undefined; onChange: (slug: string | undefined) => void }) {
    const shown = value ?? toSlug(name);
    const bad = value !== undefined && !isFreeSlugWord(value);
    return (
        <div>
            <Label htmlFor={id}>ID</Label>
            <Input
                id={id}
                value={shown}
                maxLength={40}
                placeholder="made from the name"
                onChange={(e) => onChange(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') || undefined)}
            />
            <p className={cn('mt-1 text-xs break-all', bad ? 'text-destructive' : 'text-muted-foreground')}>
                {bad ? SLUG_HINT : `/${base}/${shown || '...'} · can't be changed later`}
            </p>
        </div>
    );
}
