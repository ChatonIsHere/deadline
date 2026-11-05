import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CrewView, GigView, LibraryView, Me, Member, SettingsView } from '@shared/schemas';
import { toast } from 'sonner';

export class ApiError extends Error {
    constructor(
        public status: number,
        message: string,
    ) {
        super(message);
    }
}

/** JSON in and out. A FormData body is sent as a file upload. */
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const json = body !== undefined && !(body instanceof FormData);
    const res = await fetch(path, {
        method,
        headers: json ? { 'Content-Type': 'application/json' } : undefined,
        body: json ? JSON.stringify(body) : (body as FormData | undefined),
    });
    if (res.status === 204) return undefined as T;

    const data = await res.json().catch(() => null);
    if (!res.ok) {
        const message = Array.isArray(data?.message) ? data.message.join(', ') : (data?.message ?? res.statusText);
        throw new ApiError(res.status, message);
    }
    return data as T;
}

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/api/me'), retry: false });

/** The signed in user. Only call inside the layout, which waits for it. */
export const useUser = () => useMe().data!;

export const useGigs = () => useQuery({ queryKey: ['gigs'], queryFn: () => api<GigView[]>('/api/gigs') });
export const useGig = (id: string | undefined) =>
    useQuery({ queryKey: ['gigs', id], queryFn: () => api<GigView>(`/api/gigs/${id}`), enabled: !!id });
export const useGigTypes = () => useQuery({ queryKey: ['gig-types'], queryFn: () => api<string[]>('/api/gigs/types') });

export const useCrews = () => useQuery({ queryKey: ['crews'], queryFn: () => api<CrewView[]>('/api/crews') });
export const useCrew = (id: string | undefined) =>
    useQuery({ queryKey: ['crews', id], queryFn: () => api<CrewView>(`/api/crews/${id}`), enabled: !!id });
export const useSettings = (enabled = true) =>
    useQuery({ queryKey: ['settings'], queryFn: () => api<SettingsView>('/api/settings'), enabled });
export const useMembers = () => useQuery({ queryKey: ['members'], queryFn: () => api<Member[]>('/api/members') });
export const useFixers = (enabled = true) => useQuery({ queryKey: ['fixers'], queryFn: () => api<Member[]>('/api/fixers'), enabled });
export const useLibrary = () => useQuery({ queryKey: ['library'], queryFn: () => api<LibraryView>('/api/library') });

/** Uploads a picture and returns its ID. */
export async function uploadImage(file: File, opts: { library?: boolean; regionId?: number | null } = {}): Promise<number> {
    const form = new FormData();
    form.append('file', file);
    if (opts.library) form.append('library', 'true');
    if (opts.regionId) form.append('regionId', String(opts.regionId));
    return (await api<{ id: number }>('/api/library/images', 'POST', form)).id;
}

export const imageUrl = (id: number) => `/images/${id}-framed.jpg`;

/** A change that refreshes everything when it lands and shows errors as toasts. */
export function useAction<A = void, R = unknown>(fn: (arg: A) => Promise<R>, done?: string | ((result: R) => void)) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: fn,
        onSuccess: (result) => {
            void queryClient.invalidateQueries();
            if (typeof done === 'string') toast.success(done);
            else done?.(result);
        },
        onError: (err) => toast.error(err.message),
    });
}
