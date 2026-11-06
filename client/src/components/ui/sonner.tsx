import { Toaster as Sonner } from 'sonner';

/**
 * Notifications as lines from the board: "// DEADLINE:" (or "// ERROR:") in front, the
 * message typed out, a blinking cursor after. No icons. The frame takes the type's colour.
 */
export function Toaster() {
    return (
        <Sonner
            theme="dark"
            position="bottom-right"
            // Lives outside the pages, so a message stays up when the page changes; it fades after this
            duration={10_000}
            // Clear the prompt bar on desktop, and the channel bar on phones
            offset={{ bottom: '4rem' }}
            mobileOffset={{ bottom: '5rem' }}
            toastOptions={{
                classNames: {
                    toast: 'group cut-frame !rounded-none !border-0 !bg-[var(--frame)] !shadow-none !px-4 !py-3 font-mono !text-sm !text-muted-foreground [--fill:var(--color-background)] [--frame:var(--color-accent)]',
                    icon: '!hidden',
                    title: cn(
                        '!font-normal motion-safe:animate-[type-in_300ms_steps(16,end)_backwards_120ms]',
                        // The prefix, in the board's cyan, or pink for errors
                        "before:mr-[1ch] before:text-accent before:content-['//_DEADLINE:']",
                        "group-data-[type=error]:before:text-destructive group-data-[type=error]:before:content-['//_ERROR:']",
                        // A block cursor after the text
                        "after:ml-1 after:inline-block after:h-[1em] after:w-[0.5em] after:translate-y-[0.15em] after:bg-accent after:content-[''] motion-safe:after:blink",
                    ),
                    description: '!text-muted-foreground',
                    error: '[--frame:var(--color-destructive)]',
                    success: '[--frame:var(--color-primary)]',
                },
            }}
        />
    );
}

const cn = (...classes: string[]) => classes.join(' ');
