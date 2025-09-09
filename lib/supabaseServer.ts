import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client (singleton).
 * - Pakai SERVICE_ROLE jika ada (untuk write).
 * - Fallback ke ANON (read-only) jika SERVICE_ROLE tidak diset.
 */
const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  process.env.SUPABASE_URL ??
  "";

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const anonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  "";

const key = serviceKey || anonKey;

if (!url || !key) {
  throw new Error(
    "[supabaseServer] Missing env. Need NEXT_PUBLIC_SUPABASE_URL and (SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY)."
  );
}

// Hindari multiple instance saat dev hot-reload
let _client: SupabaseClient;

declare global {
  // eslint-disable-next-line no-var
  var __supabaseServer__: SupabaseClient | undefined;
}

if (process.env.NODE_ENV !== "production") {
  if (!global.__supabaseServer__) {
    global.__supabaseServer__ = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  _client = global.__supabaseServer__;
} else {
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const supabaseServer = _client;
