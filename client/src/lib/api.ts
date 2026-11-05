import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CrewView, FixerSummary, GigView, LibraryView, Me, Member, RunnerCard, RunnerSummary, RunnerView, SettingsView } from '@shared/schemas';
import { framedFile, plainFile } from '@shared/images';
import { toast } from 'sonner';

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
        throw new Error(message);
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
export const useLibrary = () => useQuery({ queryKey: ['library'], queryFn: () => api<LibraryView>('/api/library') });

export const useRunners = () => useQuery({ queryKey: ['runners'], queryFn: () => api<RunnerSummary[]>('/api/runners') });
export const useMyRunners = () => useQuery({ queryKey: ['runners', 'mine'], queryFn: () => api<RunnerCard[]>('/api/runners/mine') });
export const useRunner = (id: string | undefined) =>
    useQuery({ queryKey: ['runners', id], queryFn: () => api<RunnerView>(`/api/runners/${id}`), enabled: !!id });
export const useFixers = () => useQuery({ queryKey: ['fixers'], queryFn: () => api<FixerSummary[]>('/api/fixers') });
export const useRoles = () => useQuery({ queryKey: ['roles'], queryFn: () => api<string[]>('/api/roles') });
/** Everyone who can be given a runner. Admins only. */
export const usePlayers = (enabled: boolean) => useQuery({ queryKey: ['players'], queryFn: () => api<Member[]>('/api/players'), enabled });

/** Uploads a picture and returns its ID. `avatar` makes a square runner picture. */
export async function uploadImage(file: File, opts: { library?: boolean; regionId?: number | null; kind?: 'gig' | 'avatar' } = {}): Promise<number> {
    const form = new FormData();
    form.append('file', file);
    if (opts.library) form.append('library', 'true');
    if (opts.regionId) form.append('regionId', String(opts.regionId));
    if (opts.kind) form.append('kind', opts.kind);
    return (await api<{ id: number }>('/api/library/images', 'POST', form)).id;
}

/** A picture with its frame, or without (for small sizes, where the frame would be lost). */
export const imageUrl = (id: number) => `/images/${framedFile(id)}`;
export const plainImageUrl = (id: number) => `/images/${plainFile(id)}`;

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
