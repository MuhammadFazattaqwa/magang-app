// Helper fetch universal (client/server) agar konsisten JSON & error handling.
export async function apiFetch<T = any>(
  input: string,
  init: RequestInit & { cache?: RequestCache } = {}
): Promise<T> {
  const base =
    process.env.NEXT_PUBLIC_BASE_URL ??
    (typeof window !== "undefined" ? window.location.origin : "");

  const url = input.startsWith("http")
    ? input
    : `${base}${input.startsWith("/") ? "" : "/"}${input}`;

  const headers = new Headers(init.headers);
  const hasBody = typeof init.body !== "undefined";
  if (hasBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(url, {
    ...init,
    headers,
    cache: init.cache ?? "no-store",
    credentials: "same-origin",
  });

  const ct = res.headers.get("content-type") || "";
  const payload = ct.includes("application/json") ? await res.json() : await res.text();

  if (!res.ok) {
    const msg =
      (payload && (payload.error?.message || payload.error || payload.message)) ||
      `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return payload as T;
}
