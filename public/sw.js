/* PWA refresh 1. Bytes must change for already-installed apps to detect an update. */
const PWA_REFRESH_KEY = "pwaRefresh";
const PWA_REFRESH_VERSION = "1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(activateAndRefreshOpenClients());
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request, { cache: "reload" }));
    return;
  }
  event.respondWith(fetch(event.request));
});

async function activateAndRefreshOpenClients() {
  await self.clients.claim();
  const windows = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  await Promise.all(windows.map((client) => refreshClientOnce(client)));
}

async function refreshClientOnce(client) {
  const current = new URL(client.url);
  if (current.searchParams.get(PWA_REFRESH_KEY) === PWA_REFRESH_VERSION) return;
  const pageWillReload = await pageAcknowledgesReload(client);
  if (pageWillReload) return;
  const next = new URL(client.url);
  next.searchParams.set(PWA_REFRESH_KEY, PWA_REFRESH_VERSION);
  if (typeof client.navigate !== "function") return;
  try {
    await client.navigate(next.href);
  } catch {
    /* Old client keeps running until the next cold start. */
  }
}

function pageAcknowledgesReload(client) {
  return new Promise((resolve) => {
    try {
      const channel = new MessageChannel();
      const timer = setTimeout(() => resolve(false), 400);
      channel.port1.onmessage = (event) => {
        clearTimeout(timer);
        resolve(event.data === "reloading" || event.data === "ready");
      };
      client.postMessage({ type: "pwa-update" }, [channel.port2]);
    } catch {
      resolve(false);
    }
  });
}
