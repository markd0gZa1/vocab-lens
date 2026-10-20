const CACHE = 'vocab-lens-v13';
// 词典单独放一个缓存，不随版本更新被清掉
const DICT_CACHE = 'vocab-lens-dict';

const PRECACHE = [
  './index.html',
  './styles.css',
  './app.js',
  './translate.js',
  './reading-order.js',
  './dictionary.js',
  './sentence-parse.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE && k !== DICT_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  // 词典太大，交给页面自己用 Cache API 管，别在请求链路上复制一遍
  if (url.pathname.endsWith('dictionary.tsv')) return;

  // 翻译模型（约 107 MB）由 transformers.js 自己缓存，这里再存一份纯属浪费空间，
  // 而且它下载时会带 Range 请求，缓存半截文件反而会坏。
  if (url.pathname.indexOf('/models/') >= 0) return;

  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;

      return fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});
