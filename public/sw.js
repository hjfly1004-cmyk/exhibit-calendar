const CACHE = 'exhibit-v7';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'data/exhibitions.json', 'icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== 'exhibit-state').map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// 새 데이터를 먼저 받고, 인터넷이 없으면 저장된 사본으로 보여 준다.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true })
      .then((hit) => hit || caches.match('index.html')))
  );
});

// 설치한 앱이 주기적으로 깨어나 오픈 예정 전시가 새로 올라왔는지 확인한다.
async function checkNew() {
  const res = await fetch('data/exhibitions.json', { cache: 'no-cache' });
  if (!res.ok) return;
  const { items } = await res.json();
  const store = await caches.open('exhibit-state');
  const read = async (key) => {
    const hit = await store.match(key);
    return hit ? hit.json() : null;
  };
  const seen = await read('state-seen');
  const config = await read('state-alert');
  await store.put('state-seen', new Response(JSON.stringify(items.map((e) => e.id))));
  if (!seen || !config) return;
  const old = new Set(seen);
  const d = new Date();
  const today = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  const fresh = items.filter((e) => !old.has(e.id) && e.start >= today
    && (config.region === '전국' || e.region === config.region));
  if (!fresh.length) return;
  const first = fresh[0];
  await self.registration.showNotification(fresh.length === 1 ? '새 전시: ' + first.title : '오픈 예정 전시 ' + fresh.length + '건이 올라왔어요', {
    body: first.title + ' · ' + first.place + ' · ' + first.start + ' 시작',
    icon: 'icons/icon-192.png',
    tag: 'new-exhibits',
    data: { url: './?fresh=1' },
  });
}

self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'new-exhibits') e.waitUntil(checkNew());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data?.url || './'));
});
