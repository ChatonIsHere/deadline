import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva('cut inline-flex items-center px-2 py-0.5 font-display text-xs font-semibold tracking-wider uppercase [--cut:5px]', {
    variants: {
        variant: {
            default: 'bg-primary text-primary-foreground',
            accent: 'bg-accent text-accent-foreground',
            success: 'bg-success text-primary-foreground',
            destructive: 'bg-destructive text-destructive-foreground',
            muted: 'bg-muted text-muted-foreground',
        },
    },
    defaultVariants: { variant: 'default' },
});

export function Badge({ className, variant, ...props }: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
    return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
