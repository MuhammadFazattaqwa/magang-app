import { DateTime } from 'luxon';

export function jakartaEffectiveDateISO(): string {
  // tanggal (YYYY-MM-DD) menurut WIB dengan cutoff -5 menit
  return DateTime.now().setZone('Asia/Jakarta').minus({ minutes: 5 }).toISODate()!;
}
