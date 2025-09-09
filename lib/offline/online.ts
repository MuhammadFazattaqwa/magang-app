// lib/offline/online.ts
import { useEffect, useState, useRef } from "react";

export function useOnlineStatus(pingIntervalMs = 5000) {
  const [online, setOnline] = useState<boolean>(typeof navigator !== "undefined" ? navigator.onLine : true);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);

    window.addEventListener("online", on);
    window.addEventListener("offline", off);

    // Ping ringan untuk verifikasi koneksi (tanpa CORS/credentials)
    async function ping() {
      try {
        // Cache-busting query agar tidak disajikan dari SW cache
        const r = await fetch(`/favicon.ico?cb=${Date.now()}`, { method: "HEAD", cache: "no-store" });
        if (r.ok) setOnline(true);
      } catch {
        setOnline(false);
      }
    }

    // Heartbeat/ping periodik: selalu jalan
    timerRef.current = window.setInterval(ping, pingIntervalMs);

    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [pingIntervalMs]);

  return online;
}
