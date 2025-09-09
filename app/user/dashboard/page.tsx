// app/user/dashboard/page.tsx  (SERVER COMPONENT — jangan pakai "use client")
import { Suspense } from "react";
import DashboardClient from "./_components/dashboard-client";

export const dynamic = "force-static"; // app-shell bisa diprerender & dicache PWA
export const revalidate = 60;          // opsional, aman buat CDN

export default function Page() {
  return (
    <Suspense fallback={<div className="p-4">Memuat…</div>}>
      <DashboardClient />
    </Suspense>
  );
}
