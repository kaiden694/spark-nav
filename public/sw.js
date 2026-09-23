const CACHE_NAME = 'xiu-theme-cache-v12';
const API_CACHE_NAME = 'xiu-api-cache-v4';
const MEDIA_CACHE_NAME = 'xiu-media-cache-v2';

const PRECACHE_URLS = [
  '/',
  '/offline.html',
  '/manifest.json',
  '/favicon.ico',
  '/nav.html',
  '/gallery.html',
  '/nav/github.html',
  '/nav/telegram.html',
  '/nav/category/featured.html',
  '/nav/category/tools.html',
  '/nav/category/github.html',
  '/nav/category/telegram.html',
  '/nav/category/creators.html',
  '/category/tools.html',
  '/category/github.html',
  '/category/telegram.html',
  '/nav-search-index.json',
  '/assets/js/nav-search-worker.js',
  '/assets/js/qrcode-lite.js',
  '/assets/js/nav-cloud-sync.js',
  '/assets/css/style.css',
  '/assets/js/jquery.min.js',
  '/assets/js/main.js',
  '/assets/fonts/iconfont.woff2',
  '/assets/fonts/iconfont.woff2?ver=8.7'
];

// 安装阶段：容错预缓存核心静态资产
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.allSettled(
        PRECACHE_URLS.map((url) =>
          fetch(url, { cache: 'reload' }).then((res) => {
            if (res.ok) return cache.put(url, res);
          }).catch((err) => console.warn('Precache failed for:', url, err))
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// 激活阶段：清理旧版本缓存并立即接管客户端 (自动清理旧 v1 媒体缓存)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== API_CACHE_NAME && name !== MEDIA_CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// 请求拦截阶段：分层缓存策略
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 0. 本地开发环境 (localhost / 127.0.0.1) 与 Vite 模块热更新请求：直接网络透传，绝不拦截缓存
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.port === '4321' || url.pathname.startsWith('/@') || url.pathname.includes('/src/')) {
    return;
  }

  // 1. [动态数据 API] 只读 API 请求：Network-First + 离线/弱网超时降级本地缓存
  const isPublicReadApi = request.method === 'GET' &&
    (url.pathname === '/api/comments' || url.pathname === '/api/likes' || url.pathname === '/api/views') &&
    !url.searchParams.has('admin') &&
    !url.searchParams.has('audit_logs') &&
    !url.searchParams.has('webhook_info') &&
    !url.searchParams.has('totp_info') &&
    !url.searchParams.has('inc');

  if (isPublicReadApi) {
    event.respondWith(
      Promise.race([
        fetch(request),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Network timeout')), 3500))
      ])
        .then((response) => {
          if (response.status === 200) {
            const clone = response.clone();
            caches.open(API_CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(async () => {
          const cachedResponse = await caches.match(request);
          if (cachedResponse) {
            const cachedClone = cachedResponse.clone();
            const newHeaders = new Headers(cachedClone.headers);
            newHeaders.set('X-SW-Cache', 'hit-offline-fallback');
            newHeaders.set('X-Offline-Status', 'stale-served');
            return new Response(cachedClone.body, {
              status: cachedClone.status,
              statusText: cachedClone.statusText,
              headers: newHeaders,
            });
          }
          return new Response(
            JSON.stringify({ ok: false, offline: true, error: '网络连接不可用，且本地尚无离线缓存' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
          );
        })
    );
    return;
  }

  // 1.5 [画廊媒体代理] /api/media 图片请求：Cache-First + 弱网极速加载与离线缓存 (自动拦截并剔除 SVG 降级污染)
  const isMediaApi = request.method === 'GET' && url.pathname === '/api/media';
  if (isMediaApi) {
    event.respondWith(
      caches.open(MEDIA_CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) {
          const cachedType = cached.headers.get('content-type') || '';
          // 若缓存的是合法的光栅位图（JPEG/PNG/WebP），直接极速响应
          if (!cachedType.includes('svg') && !cachedType.includes('html') && !cachedType.includes('text')) {
            return cached;
          }
          // 若缓存池中存在旧版残留的 SVG 降级假图或 HTML 错误流，主动从缓存彻底剔除
          await cache.delete(request);
        }

        try {
          const networkResponse = await fetch(request);
          const cType = networkResponse.headers.get('content-type') || '';
          // 仅对真正的真实博主图片（JPEG/PNG/WebP）进行缓存，绝不污染缓存池存储 SVG 兜底图
          if (networkResponse.status === 200 && !cType.includes('svg') && !cType.includes('html') && !cType.includes('text')) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        } catch (err) {
          return new Response(null, { status: 504, statusText: 'Media Offline' });
        }
      })
    );
    return;
  }

  // 1.8 [全局搜索与导航索引] Stale-While-Revalidate (SWR 模式：本地极速秒开 + 后台静默更新)
  const isSearchIndex = request.method === 'GET' &&
    (url.pathname === '/search-index.json' || url.pathname === '/nav-search-index.json');

  if (isSearchIndex) {
    event.respondWith(
      caches.open(API_CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        const fetchPromise = fetch(request).then((networkResponse) => {
          if (networkResponse.status === 200) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        }).catch(() => null);

        // 如果本地已缓存索引，立即 0 毫秒秒开返回，并在后台静默更新缓存池
        if (cached) {
          event.waitUntil(fetchPromise);
          return cached;
        }

        // 本地尚无缓存时，等待网络拉取；拉取失败时返回安全空数组
        const networkResponse = await fetchPromise;
        if (networkResponse) return networkResponse;
        return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
      })
    );
    return;
  }

  // 2. 忽略非 GET 请求及管理员/写操作 API
  if (request.method !== 'GET' || url.pathname.startsWith('/api/')) {
    return;
  }

  // 2. HTML 页面导航请求：Network-First，断网降级至缓存，无缓存降级至 /offline.html
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(async () => {
          const cachedResponse = await caches.match(request);
          if (cachedResponse) {
            return cachedResponse;
          }
          const offlinePage = await caches.match('/offline.html');
          if (offlinePage) {
            return offlinePage;
          }
          return new Response(
            '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>离线提示</title></head><body style="font-family:sans-serif;text-align:center;padding:50px;"><h2>当前处于离线状态</h2><p>网络连接恢复后请刷新重试。</p></body></html>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        })
    );
    return;
  }

  // 3. 静态资产（Astro 编译包、字体、CSS、JS、图片）：Cache-First，未命中拉取并存盘
  if (
    url.pathname.startsWith('/_astro/') ||
    url.pathname.startsWith('/assets/') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.woff2') ||
    url.pathname.endsWith('.woff') ||
    url.pathname.endsWith('.ttf') ||
    url.pathname.endsWith('.avif') ||
    url.pathname.endsWith('.webp') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.svg')
  ) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request).then((networkResponse) => {
          if (networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // 4. 其他普通请求正常网络透传，失败尝试缓存
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});

// 5. 离线后台同步与连接恢复事件桥接 (Background Sync)
self.addEventListener('sync', (event) => {
  if (event.tag === 'xiu-offline-sync') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'TRIGGER_OFFLINE_SYNC' });
        });
      })
    );
  }
});
