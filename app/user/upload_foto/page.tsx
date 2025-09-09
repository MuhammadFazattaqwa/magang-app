// app/user/upload_foto/page.tsx
import { Suspense } from "react";
import UploadFotoClient from "./UploadFotoClient";

// Hindari prerender & ISR untuk halaman full-CSR ini
export const dynamic = "force-dynamic"; // <- string biasa, tanpa "as const"
export const revalidate = 0;            // 0 = no ISR

export default function Page() {
  return (
    <Suspense fallback={<div className="p-4 text-center text-sm text-gray-600">Memuat…</div>}>
      <UploadFotoClient />
    </Suspense>
  );
}
