import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  // gunakan SERVICE_ROLE_KEY untuk route server (jangan expose ke client)
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
