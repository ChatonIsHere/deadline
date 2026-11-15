import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CrewInvite, CrewView, FixerSummary, GigCrew, GigView, LibraryView, Me, Member, MyAvailability, MySignups, PlayerAvailability, Prefs, RunnerCard, RunnerSummary, RunnerView, SettingsView } from '@shared/schemas';
import { artPreviewFile, artThumbFile, mediumFile, plainFile, thumbFile, type UploadKind, webFile } from '@shared/images';
import { toast } from 'sonner';
import { useAllowNextNavigation } from '@/lib/unsaved';

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

/** Crews that were on a gig, for HQ IP at the debrief. Admins only. */
export const useGigCrews = (id: string) => useQuery({ queryKey: ['gigs', id, 'crews'], queryFn: () => api<GigCrew[]>(`/api/gigs/${id}/crews`) });
export const useGigs = () => useQuery({ queryKey: ['gigs'], queryFn: () => api<GigView[]>('/api/gigs') });
export const useGig = (id: string | undefined) =>
    useQuery({ queryKey: ['gigs', id], queryFn: () => api<GigView>(`/api/gigs/${id}`), enabled: !!id });
/** How many live gigs the signed in player is on, and the limit. Under 'gigs' so it refreshes with them. */
export const useMySignups = () => useQuery({ queryKey: ['gigs', 'my-signups'], queryFn: () => api<MySignups>('/api/gigs/my-signups') });
export const useGigTypes = () => useQuery({ queryKey: ['gig-types'], queryFn: () => api<string[]>('/api/gigs/types') });

export const usePrefs = () => useQuery({ queryKey: ['prefs'], queryFn: () => api<Prefs>('/api/prefs') });
export const useMyAvailability = () => useQuery({ queryKey: ['availability', 'mine'], queryFn: () => api<MyAvailability>('/api/availability/mine') });
/** Everyone's week, for the heatmap. Admins only. */
export const useAvailability = (enabled: boolean) => useQuery({ queryKey: ['availability'], queryFn: () => api<PlayerAvailability[]>('/api/availability'), enabled });

/** Crew invites waiting on the signed in player's runners. */
export const useCrewInvites = () => useQuery({ queryKey: ['crews', 'invites'], queryFn: () => api<CrewInvite[]>('/api/crews/invites') });
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

/** `library` adds it to the picture library (admins). `avatar` makes a square runner picture, `art` a runner's full art. */
export interface UploadOptions {
    library?: boolean;
    regionId?: string | null;
    kind?: UploadKind;
}

/** Uploads a picture and returns its ID. Use UploadButton rather than calling this. */
export async function uploadImage(file: File, opts: UploadOptions = {}): Promise<string> {
    const form = new FormData();
    form.append('file', file);
    if (opts.library) form.append('library', 'true');
    if (opts.regionId) form.append('regionId', String(opts.regionId));
    if (opts.kind) form.append('kind', opts.kind);
    return (await api<{ id: string }>('/api/library/images', 'POST', form)).id;
}

/** The framed picture for the web (frame to the edge), or the plain one. Discord gets a padded copy. */
/**
 * Where pictures live: the S3 bucket (linked directly), or this server in local dev. Set once
 * from /api/config before the app starts (see main.tsx).
 */
let imageBase = '/';
export async function loadConfig() {
    const res = await fetch('/api/config').catch(() => null);
    if (res?.ok) imageBase = ((await res.json()) as { imageBase: string }).imageBase;
}
const stored = (key: string) => `${imageBase}${key}`;

export const imageUrl = (id: string) => stored(webFile(id));
export const plainImageUrl = (id: string) => stored(plainFile(id));
/** Small copies: thumb for pickers, grids and avatars, medium for gig cards. */
export const thumbUrl = (id: string) => stored(thumbFile(id));
export const mediumUrl = (id: string) => stored(mediumFile(id));
/** A gallery picture at full size, on their profile, and in the row to pick from. */
export const artUrl = plainImageUrl;
export const artPreviewUrl = (id: string) => stored(artPreviewFile(id));
export const artThumbUrl = (id: string) => stored(artThumbFile(id));

/**
 * A change sent to the server. Every one says what happened, as a notification from the
 * board that stays up across pages and fades after a few seconds. `message` is that line (or
 * made from the result), `then` is anything to do after, like going to the new page.
 * Errors show as notifications too. Everything refreshes when it lands.
 */
export function useAction<A = void, R = unknown>(fn: (arg: A) => Promise<R>, message: string | ((result: R) => string), then?: (result: R) => void) {
    const queryClient = useQueryClient();
    const allowNavigation = useAllowNextNavigation();
    return useMutation({
        mutationFn: fn,
        onSuccess: (result) => {
            void queryClient.invalidateQueries();
            toast.success(typeof message === 'function' ? message(result) : message);
            // What it saved is saved, so the page it moves on to isn't blocked
            allowNavigation?.();
            then?.(result);
        },
        onError: (err) => toast.error(err.message),
    });
}
