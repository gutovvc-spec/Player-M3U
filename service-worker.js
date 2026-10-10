const CACHE_NAME = "player-m3u-shell-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./playlist.js",
  "./renderer.js",
  "./manifest.webmanifest",
  "./icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./vendor/hls.min.js",
  "./vendor/mpegts.js"
];
const APP_SHELL_URLS = new Set(APP_SHELL.map((path) => new URL(path, self.location.href).href));

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || !APP_SHELL_URLS.has(url.href)) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(
            caches.open(CACHE_NAME)
              .then((cache) => cache.put(request, copy))
              .catch((error) => console.error("Não foi possível atualizar o cache do aplicativo.", error))
          );
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        throw new Error("Este conteúdo não está disponível offline.");
      })
  );
});
