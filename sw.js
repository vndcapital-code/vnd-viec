// Lưu sẵn giao diện để mở nhanh; dữ liệu luôn lấy mới từ máy chủ.
const V = 'vnd-viec-v8';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'config.js', 'manifest.webmanifest',
  'icon-192.png', 'icon-512.png', 'favicon.png', 'jspdf.umd.min.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.hostname.endsWith('script.google.com') || u.hostname.endsWith('googleusercontent.com')
      || u.hostname === 'accounts.google.com') return;
  // Giao diện: lấy bản mới nếu có mạng, mất mạng thì dùng bản đã lưu
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok && (u.origin === location.origin || false)) {
      const cp = r.clone(); caches.open(V).then(c => c.put(e.request, cp));
    }
    return r;
  }).catch(() => caches.match(e.request)));
});
