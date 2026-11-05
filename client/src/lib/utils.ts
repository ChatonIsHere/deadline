import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

/** The first problem in a failed zod check, for showing under a form. */
export function firstIssue(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
    const issue = error.issues[0];
    return `${issue.path.join(' ') || 'form'}: ${issue.message}`;
}
