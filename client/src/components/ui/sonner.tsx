import { Toaster as Sonner } from 'sonner';

export function Toaster() {
    return (
        <Sonner
            theme="dark"
            position="bottom-right"
            toastOptions={{
                classNames: {
                    toast: 'cut-frame !rounded-none !border-0 !bg-transparent font-mono !text-foreground',
                    error: '[--frame:var(--color-destructive)]',
                    success: '[--frame:var(--color-primary)]',
                },
            }}
        />
    );
}
