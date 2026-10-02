import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

const PWA_REFRESH_KEY = "pwaRefresh";
const PWA_RELOAD_MARK = "pwa-reloaded-at";

function clearPwaRefreshParam(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(PWA_REFRESH_KEY)) return;
  url.searchParams.delete(PWA_REFRESH_KEY);
  window.history.replaceState(
    window.history.state,
    "",
    url.pathname + url.search + url.hash
  );
}

function recentReload(): boolean {
  try {
    const previous = Number(sessionStorage.getItem(PWA_RELOAD_MARK) || 0);
    return Date.now() - previous < 10000;
  } catch {
    return false;
  }
}

function markReload(): void {
  try {
    sessionStorage.setItem(PWA_RELOAD_MARK, String(Date.now()));
  } catch {
    /* Reload guard still applies for this document. */
  }
}

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const arrivedFromSwRefresh = new URL(window.location.href).searchParams.has(
      PWA_REFRESH_KEY
    );
    if (arrivedFromSwRefresh) markReload();
    clearPwaRefreshParam();
    void registerProductionServiceWorker();
  });
}

async function registerProductionServiceWorker(): Promise<void> {
  const hadController = navigator.serviceWorker.controller != null;
  let reloaded = false;
  const reloadOnce = () => {
    if (!hadController || reloaded || recentReload()) return;
    reloaded = true;
    markReload();
    window.location.reload();
  };

  navigator.serviceWorker.addEventListener("controllerchange", reloadOnce);
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type !== "pwa-update") return;
    const port = event.ports[0];
    if (hadController && !reloaded && !recentReload()) {
      port?.postMessage("reloading");
      reloadOnce();
      return;
    }
    port?.postMessage("ready");
  });

  try {
    const registration = await navigator.serviceWorker.register("/sw.js", {
      updateViaCache: "none",
    });
    await registration.update();
  } catch {
    /* App stays usable when service worker registration fails. */
  }
}