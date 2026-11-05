import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
    'cut inline-flex h-9 cursor-pointer items-center justify-center gap-2 px-4 font-display text-sm font-semibold tracking-wider whitespace-nowrap uppercase transition-colors disabled:pointer-events-none disabled:opacity-40',
    {
        variants: {
            variant: {
                default: 'bg-primary text-primary-foreground hover:bg-primary/80',
                accent: 'bg-accent text-accent-foreground hover:bg-accent/80',
                destructive: 'bg-destructive text-white hover:bg-destructive/80',
                outline: 'cut-frame [--fill:var(--color-background)] hover:[--frame:var(--color-primary)]',
                ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground',
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
