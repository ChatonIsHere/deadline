import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CrewView, GigView, Me, Member, SettingsView } from '@shared/schemas';
import { toast } from 'sonner';

export class ApiError extends Error {
    constructor(
        public status: number,
        message: string,
    ) {
        super(message);
    }
}

export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const res = await fetch(path, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
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
