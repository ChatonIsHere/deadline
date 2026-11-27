// Deadline's service worker. Only for push notifications from chats: nothing is cached, so the
// site always loads fresh. See client/src/lib/push.ts.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch {
        data = { title: 'Deadline', body: event.data ? event.data.text() : '' };
    }
    event.waitUntil(
        self.registration.showNotification(data.title || 'Deadline', {
            body: data.body || '',
            tag: data.tag,
            // A new message in the same chat replaces the old notification, and still buzzes
            renotify: !!data.tag,
            icon: '/icons/icon-192.png',
            badge: '/icons/icon-192.png',
            data: { url: data.url || '/messages' },
        }),
    );
});

// Opens the chat: in a Deadline tab that's already open if there is one
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = new URL(event.notification.data?.url || '/messages', self.location.origin).href;
    event.waitUntil(
        (async () => {
            const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
            const tab = tabs.find((t) => new URL(t.url).origin === self.location.origin);
            if (tab) {
                await tab.focus();
                // The app handles this without a reload (see client/src/lib/push.ts)
                tab.postMessage({ type: 'open', url });
                return;
            }
            await self.clients.openWindow(url);
        })(),
    );
});
