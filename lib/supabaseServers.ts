// lib/supabaseServer.ts
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY; // salah satu

if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
if (!serviceKey)
  console.warn(
    "[supabase] Warning: SUPABASE_SERVICE_ROLE_KEY not set. Upload may fail if bucket is private."
  );

export function supabaseServer() {
  return createClient(supabaseUrl, serviceKey ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
