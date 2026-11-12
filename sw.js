// Mở nhanh: giao diện lấy ngay từ bộ nhớ máy, đồng thời tải bản mới ngầm cho lần sau. Nhận thông báo bật lên.
const V = 'vnd-viec-v13';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'config.js', 'manifest.webmanifest',
  'icon-192.png', 'icon-512.png', 'favicon.png', 'jspdf.umd.min.js'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  const key = e.request.mode === 'navigate' ? './' : e.request;
  e.respondWith(caches.open(V).then(async c => {
    const hit = await c.match(key, { ignoreSearch: true });
    const net = fetch(e.request, { cache: 'no-cache' }).then(r => { if (r.ok) c.put(key, r.clone()); return r; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    return (await net) || new Response('Mất kết nối', { status: 503 });
  }));
});

// Thông báo từ máy chủ (Firebase gửi dạng dữ liệu: title, body, link, tag)
self.addEventListener('push', e => {
  let j = {}; try { j = e.data ? e.data.json() : {}; } catch (x) { j = { data: { body: e.data && e.data.text() } }; }
  const d = j.data || j.notification || j;
  const title = d.title || 'VND CAPITAL';
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || '', icon: 'icon-192.png', badge: 'favicon.png',
    tag: d.tag || undefined, renotify: !!d.tag, data: { link: d.link || './' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const link = new URL((e.notification.data && e.notification.data.link) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    const c = cs.find(x => x.url.startsWith(self.registration.scope));
    if (c) { c.postMessage({ type: 'open', link: link }); return c.focus(); }
    return self.clients.openWindow(link);
  }));
});
