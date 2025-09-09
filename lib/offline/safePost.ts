// lib/offline/safePost.ts
export type SafePostResult =
  | { status: "ok" }
  | { status: "queued"; queueId: string }
  | { status: "error"; httpStatus?: number; message?: string };

export async function safePostJSON(endpoint: string, payload: any): Promise<SafePostResult> {
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const ct = res.headers.get("content-type") || "";
    let data: any = null;
    if (ct.includes("application/json")) {
      try { data = await res.json(); } catch {}
    } else {
      try { data = JSON.parse(await res.text()); } catch {}
    }

    if (res.ok) {
      if (data?.status === "queued" && data?.queueId) {
        return { status: "queued", queueId: String(data.queueId) };
      }
      return { status: "ok" };
    }
    return { status: "error", httpStatus: res.status, message: data?.message || data?.error || res.statusText };
  } catch (e: any) {
    return { status: "error", message: e?.message || "network error" };
  }
}
