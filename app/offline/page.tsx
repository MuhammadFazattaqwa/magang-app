// app/offline/page.tsx
export const dynamic = "force-static";
export const revalidate = false;

export default function OfflinePage() {
  return (
    <html>
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 16 }}>
        <h1 style={{ fontWeight: 700 }}>Offline</h1>
        <p style={{ maxWidth: 420 }}>
          Anda sedang offline. Buka kembali halaman ini setelah koneksi tersedia,
          atau muat ulang halaman yang sebelumnya sudah Anda kunjungi saat online.
        </p>
        <p>
          <a href="/" style={{ color: "#2563eb", textDecoration: "underline" }}>
            Kembali ke beranda
          </a>
        </p>
      </body>
    </html>
  );
}
