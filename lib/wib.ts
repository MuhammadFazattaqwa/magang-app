// Tanggal efektif WIB dengan cutoff 00:05
export function effectiveWIBDate(date = new Date()): string {
  const tz = "Asia/Jakarta";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const num = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  let y = num("year"); let m = num("month"); let d = num("day");
  const hh = num("hour"); const mm = num("minute");

  // sebelum 00:05 WIB → masih dihitung hari sebelumnya
  if (hh === 0 && mm < 5) {
    const dt = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
    dt.setUTCDate(dt.getUTCDate() - 1);
    y = dt.getUTCFullYear(); m = dt.getUTCMonth() + 1; d = dt.getUTCDate();
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}-${pad(m)}-${pad(d)}`;
}
