import { createClient } from "@supabase/supabase-js";

// Dipakai di komponen "use client" bila kamu perlu akses Supabase dari browser
export function supabaseBrowser() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: true } }
  );
}
