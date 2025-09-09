// lib/offline/uploader.ts
export async function safeUpload(opts: {
  endpoint: string;
  formData: FormData;
  meta?: Record<string, any>;
}): Promise<
  | { status: "uploaded"; jobId?: string; categoryId?: string; photoUrl?: string; thumbUrl?: string; serialNumber?: string; meter?: number }
  | { status: "queued"; queueId: string }
  | { status: "error"; message?: string; httpStatus?: number }
> {
  try {
    const res = await fetch(opts.endpoint, { method: "POST", body: opts.formData });

    // kalau SW mengantrikan permintaan (offline), server-side respon akan berisi status queued
    let json: any = null;
    try { json = await res.clone().json(); } catch { json = null; }

    if (json && json.status === "queued") {
      return { status: "queued", queueId: String(json.queueId) };
    }

    if (!res.ok) {
      return { status: "error", httpStatus: res.status, message: json?.error || res.statusText };
    }

    // ONLINE sukses → umumkan ke halaman, supaya UI update & langsung persist
    if (json?.ok) {
      try {
        if (navigator.serviceWorker?.controller) {
          navigator.serviceWorker.controller.postMessage({
            type: "upload-online-ack",
            ...json, // jobId, categoryId, photoUrl, thumbUrl, serialNumber, meter
          });
          navigator.serviceWorker.controller.postMessage({ type: "persist-now" });
        }
      } catch {}
      return { status: "uploaded", ...json };
    }

    return { status: "uploaded" };
  } catch (err: any) {
    // benar2 gagal fetch (mis. offline & SW tak intercept) — kembalikan error generik
    return { status: "error", message: err?.message || "Network error" };
  }
}
