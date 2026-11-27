import { api } from '@/lib/api';

/**
 * Push notifications for chats: a service worker (assets/sw.js) shows them, even with
 * Deadline closed. Each browser subscribes once; which chats notify is chosen per chat.
 */

export type PushState =
    /** This browser can't (or, on iPhone, can't until Deadline is on the Home Screen) */
    | 'unsupported'
    /** The server has push turned off */
    | 'off'
    /** Notifications are blocked for the site */
    | 'blocked'
    /** Not turned on in this browser yet */
    | 'ask'
    | 'on';

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** Whether an iPhone or iPad is missing out because Deadline isn't on the Home Screen. */
export const needsHomeScreen = () => /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.matchMedia('(display-mode: standalone)').matches;

let key: Promise<string | null> | null = null;
const serverKey = () => (key ??= api<{ key: string | null }>('/api/push/key').then((r) => r.key));

const registration = () => navigator.serviceWorker.register('/sw.js');

export async function pushState(): Promise<PushState> {
    if (!supported()) return 'unsupported';
    if (!(await serverKey().catch(() => null))) return 'off';
    if (Notification.permission === 'denied') return 'blocked';
    const sub = await (await registration()).pushManager.getSubscription();
    return sub && Notification.permission === 'granted' ? 'on' : 'ask';
}

/** Turns push on in this browser. Call from a click: browsers only ask then. Returns the state after. */
export async function enablePush(): Promise<PushState> {
    if (!supported()) return 'unsupported';
    const applicationServerKey = await serverKey();
    if (!applicationServerKey) return 'off';
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'ask';
    const reg = await registration();
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64Url(applicationServerKey) }));
    await api('/api/push/subscriptions', 'POST', sub.toJSON());
    return 'on';
}

/** Stops push in this browser. Chats keep their bell for any other devices. */
export async function disablePush() {
    if (!supported()) return;
    const sub = await (await registration()).pushManager.getSubscription();
    if (!sub) return;
    await api('/api/push/subscriptions', 'DELETE', { endpoint: sub.endpoint });
    await sub.unsubscribe();
}

/**
 * On each load: a browser with push on tells the server its subscription again (it can change,
 * or this may be someone else signing in on it), and clicks on notifications open the chat in this tab.
 */
export async function startPush(navigate: (url: string) => void) {
    if (!supported()) return;
    navigator.serviceWorker.addEventListener('message', (event: MessageEvent<{ type?: string; url?: string }>) => {
        if (event.data?.type === 'open' && event.data.url) navigate(new URL(event.data.url).pathname);
    });
    if (Notification.permission !== 'granted') return;
    const sub = await (await registration()).pushManager.getSubscription();
    if (sub) await api('/api/push/subscriptions', 'POST', sub.toJSON()).catch(() => undefined);
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
    const base64 = (text + '='.repeat((4 - (text.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const bytes = new Uint8Array(new ArrayBuffer(raw.length));
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
}
