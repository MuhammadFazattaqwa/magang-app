"use client";
import { useEffect } from "react";

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    (async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });

        // auto reload sekali saat SW baru terpasang (agar file public ter-cache fresh)
        reg.addEventListener?.("updatefound", () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener("statechange", () => {
            if (
              sw.state === "installed" &&
              navigator.serviceWorker.controller &&
              !sessionStorage.getItem("sw-reloaded-once")
            ) {
              sessionStorage.setItem("sw-reloaded-once", "1");
              location.reload();
            }
          });
        });

        const ready = await navigator.serviceWorker.ready;
        const post = (msg: any) =>
          ready?.active?.postMessage?.(msg) ||
          navigator.serviceWorker.controller?.postMessage?.(msg);

        // saat sudah ada controller → dorong sinkronisasi + persist snapshot
        if (navigator.serviceWorker.controller) {
          post({ type: "force-sync" });
          post({ type: "heartbeat" });
          post({ type: "persist-now" });
        }

        // ketika SW mengambil alih kontrol halaman
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          setTimeout(() => {
            navigator.serviceWorker.controller?.postMessage?.({ type: "force-sync" });
            navigator.serviceWorker.controller?.postMessage?.({ type: "heartbeat" });
            navigator.serviceWorker.controller?.postMessage?.({ type: "persist-now" });
          }, 250);
        });

        // ketika kembali online → push sync + persist
        const onOnline = () => {
          post({ type: "force-sync" });
          post({ type: "persist-now" });
          let tries = 3;
          const t = setInterval(() => {
            if (tries-- <= 0) return clearInterval(t);
            post({ type: "heartbeat" });
          }, 700);
        };
        window.addEventListener("online", onOnline);

        // bila tab akan disembunyikan, pastikan snapshot dipersist
        const onHidden = () => {
          if (document.visibilityState === "hidden") post({ type: "persist-now" });
        };
        document.addEventListener("visibilitychange", onHidden);

        return () => {
          window.removeEventListener("online", onOnline);
          document.removeEventListener("visibilitychange", onHidden);
        };
      } catch (e) {
        console.warn("SW register failed:", e);
      }
    })();
  }, []);

  return null;
}
