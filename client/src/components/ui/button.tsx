import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
    'cut inline-flex h-9 cursor-pointer outline-none items-center justify-center gap-2 px-4 font-display text-sm font-semibold tracking-wider whitespace-nowrap uppercase transition-colors disabled:pointer-events-none disabled:opacity-40',
    {
        variants: {
            variant: {
                // Filled buttons show focus as a dark line just inside the edge
                default: 'bg-primary text-primary-foreground hover:bg-primary/80 focus-visible:shadow-[inset_0_0_0_2px_var(--color-background)]',
                accent: 'bg-accent text-accent-foreground hover:bg-accent/80 focus-visible:shadow-[inset_0_0_0_2px_var(--color-background)]',
                destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/80 focus-visible:shadow-[inset_0_0_0_2px_var(--color-background)]',
                outline: 'cut-frame [--fill:var(--color-background)] hover:[--frame:var(--color-primary)] focus-visible:[--frame:var(--color-accent)]',
                ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground focus-visible:shadow-[inset_0_0_0_2px_var(--color-accent)]',
            },
            size: {
                default: '',
                sm: 'h-7 px-3 text-xs [--cut:6px]',
                icon: 'size-8 px-0 [--cut:6px]',
            },
        },
        defaultVariants: { variant: 'default', size: 'default' },
    },
);

type ButtonProps = ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild, ...props }: ButtonProps) {
    const Comp = asChild ? Slot.Root : 'button';
    return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
