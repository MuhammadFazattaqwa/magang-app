import { idbAdd, idbDelete, idbGetAll, type PendingUpload } from "./idb";

export function genId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Serialisasi FormData supaya bisa disimpan ke IndexedDB */
export async function formDataToStorable(fd: FormData) {
  const parts: { key: string; fileName: string; type: string; bytes: ArrayBuffer }[] = [];
  for (const [key, val] of fd.entries()) {
    if (val instanceof File) {
      const buf = await val.arrayBuffer();
      parts.push({
        key,
        fileName: val.name,
        type: val.type || "application/octet-stream",
        bytes: buf,
      });
    } else {
      const blob = new Blob([String(val)], { type: "text/plain" });
      const buf = await blob.arrayBuffer();
      parts.push({
        key,
        fileName: `${key}.txt`,
        type: "text/plain",
        bytes: buf,
      });
    }
  }
  return parts;
}

export async function enqueueUpload(params: {
  endpoint: string;
  formData: FormData;
  method?: "POST" | "PUT";
  headers?: Record<string, string>;
  meta?: Record<string, any>;
}) {
  const { endpoint, formData, method = "POST", headers, meta } = params;
  const id = genId();
  const bodyParts = await formDataToStorable(formData);

  const item: PendingUpload = {
    id,
    createdAt: Date.now(),
    endpoint,
    method,
    headers,
    bodyType: "formdata",
    body: bodyParts,
    meta,
  };
  await idbAdd(item);
  return id;
}

export async function processQueue(
  uploader?: (p: PendingUpload) => Promise<Response>
) {
  const items = await idbGetAll();
  const okIds: string[] = [];

  for (const p of items) {
    try {
      const res = await (uploader ? uploader(p) : defaultUploader(p));
      if (res.ok) {
        await idbDelete(p.id);
        okIds.push(p.id);
      }
    } catch {
      /* biarkan di antrean */
    }
  }

  return okIds;
}

async function defaultUploader(p: PendingUpload): Promise<Response> {
  if (p.bodyType === "formdata") {
    const fd = new FormData();
    for (const part of p.body as any[]) {
      const file = new File([new Uint8Array(part.bytes)], part.fileName, {
        type: part.type,
      });
      fd.append(part.key, file);
    }
    return fetch(p.endpoint, { method: p.method, headers: p.headers, body: fd });
  }

  return fetch(p.endpoint, {
    method: p.method,
    headers: { ...(p.headers || {}), "Content-Type": "application/octet-stream" },
    body: p.body as ArrayBuffer,
  });
}