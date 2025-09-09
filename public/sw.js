/* public/sw.js — patched */
const VERSION = "magang-app-v1.0.31";
const STATIC_CACHE  = VERSION + "-static";
const DYNAMIC_CACHE = VERSION + "-dynamic";

const APP_SHELL = [
  "/",
  "/user/dashboard",
  "/user/upload_foto",
  "/auth/login",
  "/offline",
  "/manifest.json",
  "/icon-192x192.png",
  "/icon-512x512.png",
];

/* ===== IndexedDB Queue (upload offline) ===== */
const QUEUE_DB = "photo-upload-queue-db";
const QUEUE_STORE = "requests";
const UPLOAD_PATH = "/api/job-photos/upload"; // HARUS sama dengan client
const META_PATH   = "/api/job-photos/meta";

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(QUEUE_DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}
async function queueAdd(rec) {
  const db = await idbOpen();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readwrite");
    tx.objectStore(QUEUE_STORE).put(rec);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
async function queueAll() {
  const db = await idbOpen();
  const items = await new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readonly");
    const req = tx.objectStore(QUEUE_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror   = () => reject(req.error);
  });
  db.close();
  return items;
}
async function queueDel(id) {
  const db = await idbOpen();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readwrite");
    tx.objectStore(QUEUE_STORE).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
async function notifyClients(msg) {
  const arr = await self.clients.matchAll({ includeUncontrolled: true });
  for (const c of arr) { try { c.postMessage(msg); } catch(_) {} }
}

/* ===== Replay helpers ===== */
function sanitizeHeaders(raw) {
  const h = {};
  if (!raw) return h;
  for (const k in raw) {
    const lk = k.toLowerCase();
    if (["content-length", "connection", "keep-alive", "proxy-connection", "transfer-encoding"].includes(lk)) continue;
    h[lk] = raw[k];
  }
  return h;
}

async function processQueue() {
  const items = await queueAll();
  const okIds = [];

  for (const item of items) {
    try {
      const headers = sanitizeHeaders(item.headers || {});
      const res = await fetch(item.url, {
        method: item.method || "POST",
        headers,
        body: item.body || null,
      });

      if (res && res.ok) {
        await queueDel(item.id);
        okIds.push(item.id);
        await notifyClients({ type: "upload-synced", queueId: item.id });
      } else {
        const code = res ? res.status : 0;
        await notifyClients({ type: "upload-error", queueId: item.id, status: code, message: `Replay failed: ${code}` });
      }
    } catch (e) {
      await notifyClients({ type: "upload-error", queueId: item.id, message: String(e) });
    }
  }

  if (okIds.length) await notifyClients({ type: "sync-complete", queueIds: okIds });
}

/* ===== Utils cache ===== */
async function precache(cache, urls) {
  await Promise.all(urls.map(async (u) => {
    try { await cache.add(new Request(u, { cache: "reload" })); } catch(_) {}
  }));
}
async function putDual(cache, req, res) {
  try { await cache.put(req, res.clone()); } catch(_) {}
  try {
    const url = new URL(req.url);
    const pathReq = new Request(url.pathname, { headers: req.headers, mode: "same-origin" });
    await cache.put(pathReq, res.clone());
  } catch(_) {}
}
async function matchHtml(urlOrReq) {
  let hit = await caches.match(urlOrReq, { ignoreSearch: true });
  if (hit) return hit;
  const url = typeof urlOrReq === "string" ? new URL(urlOrReq, self.location.origin) : new URL(urlOrReq.url);
  const candidates = [
    url.href,
    url.pathname + url.hash,
    url.pathname,
    url.pathname.replace(/\/$/, ""),
    url.pathname.endsWith("/") ? url.pathname : url.pathname + "/",
  ];
  for (const c of candidates) {
    hit = await caches.match(c, { ignoreSearch: true });
    if (hit) return hit;
  }
  return null;
}

/* ===== Install / Activate ===== */
self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await precache(cache, APP_SHELL);
  })());
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) =>
        (k.startsWith("magang-app-") && k !== STATIC_CACHE && k !== DYNAMIC_CACHE)
          ? caches.delete(k)
          : Promise.resolve()
      ))
    )
  );
  self.clients.claim();
});

/* ===== Background Sync & Messages ===== */
self.addEventListener("sync", (e) => {
  if (e.tag === "photo-upload-sync" || e.tag === "meta-sync") e.waitUntil(processQueue());
});
self.addEventListener("message", (e) => {
  if (e.data?.type === "force-sync") {
    e.waitUntil(processQueue());
  }
  if (e.data?.type === "heartbeat") {
    e.waitUntil((async () => {
      const items = await queueAll();
      if (items.length) await processQueue();
    })());
  }
  if (e.data?.type === "persist-now") {
    notifyClients({ type: "persist-now" });
  }
});

/* ===== Fetch ===== */
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // 0) Intercept upload/meta: online-first; gagal → antre
  if (req.method === "POST" && (url.pathname === UPLOAD_PATH || url.pathname === META_PATH)) {
    e.respondWith((async () => {
      try {
        const onlineRes = await fetch(req.clone());
        // Kirim ACK ke client kalau upload endpoint
        if (url.pathname === UPLOAD_PATH) {
          try {
            const resClone = onlineRes.clone();
            const data = await resClone.json().catch(() => null);
            if (data && (data.ok || data.photoUrl || data.thumbUrl)) {
              await notifyClients({
                type: "upload-online-ack",
                categoryId: data.categoryId || null,
                thumbUrl: data.thumbUrl || null,
                serialNumber: data.serialNumber || null,
                meter: typeof data.meter === "number" ? data.meter : null
              });
              await notifyClients({ type: "persist-now" });
            }
          } catch(_) {}
        }
        return onlineRes;
      } catch {
        // enqueue saat offline
        const body = await req.clone().arrayBuffer();
        const headers = {};
        req.headers.forEach((v, k) => (headers[k] = v));
        const id = Date.now() + "-" + Math.random().toString(36).slice(2);
        await queueAdd({ id, url: req.url, method: "POST", headers, body, createdAt: Date.now(), kind: (url.pathname === META_PATH ? "meta" : "upload") });
        try {
          await self.registration.sync.register(url.pathname === META_PATH ? "meta-sync" : "photo-upload-sync");
        } catch(_) {}
        return new Response(JSON.stringify({ status: "queued", queueId: id }), {
          headers: { "Content-Type": "application/json" },
        });
      }
    })());
    return;
  }

  if (req.method !== "GET") return;

  const isSameOrigin = url.origin === self.location.origin;
  const accept = req.headers.get("accept") || "";
  const isHTML  = req.mode === "navigate" || accept.includes("text/html");

  // 1) HTML → network-first; cache
  if (isHTML) {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        const resForCache = res.clone();
        e.waitUntil(caches.open(DYNAMIC_CACHE).then((c) => putDual(c, req, resForCache)));
        return res;
      } catch {
        return (
          (await matchHtml(req)) ||
          (await caches.match("/", { ignoreSearch: true })) ||
          (await caches.match("/offline", { ignoreSearch: true })) ||
          new Response("<h1>Offline</h1>", { headers: { "Content-Type": "text/html" } })
        );
      }
    })());
    return;
  }

  // 2) Static assets → stale-while-revalidate
  const isStatic =
    isSameOrigin &&
    (url.pathname.startsWith("/_next/") ||
     /\.(?:js|css|woff2?|ttf|eot|png|jpg|jpeg|gif|svg|webp|ico)$/i.test(url.pathname));

  if (isStatic) {
    e.respondWith((async () => {
      const cache = await caches.open(DYNAMIC_CACHE);
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req).then((res) => {
        const copy = res.clone();
        e.waitUntil(cache.put(req, copy));
        return res;
      }).catch(() => null);
      return cached || (await network) || (await matchHtml("/offline"));
    })());
    return;
  }

  // 3) API GET → network-first + fallback cache
  if (url.pathname.startsWith("/api/")) {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        const resForCache = res.clone();
        e.waitUntil(caches.open(DYNAMIC_CACHE).then((c) => putDual(c, req, resForCache)));
        return res;
      } catch {
        const hit = await caches.match(req, { ignoreSearch: true });
        return hit || new Response(JSON.stringify({ error: "offline" }), {
          headers: { "Content-Type": "application/json" },
          status: 503,
        });
      }
    })());
    return;
  }

  // 4) Lainnya → network-first biasa
  e.respondWith((async () => {
    try { return await fetch(req); }
    catch { return (await caches.match(req, { ignoreSearch: true })) || Response.error(); }
  })());
});
