import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser Supabase client (anon key only). Returns null if env is missing.
 * Next step: call from storage/sync layer — do not import from UI components.
 */
let browserClient: SupabaseClient | null = null;

function readEnv(): { url: string; anonKey: string } | null {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? "";
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function isSupabaseConfigured(): boolean {
  return readEnv() != null;
}

/** Singleton anon client for worker-hours-app. */
export function getSupabaseBrowserClient(): SupabaseClient | null {
  const env = readEnv();
  if (env == null) return null;
  if (browserClient == null) {
    browserClient = createClient(env.url, env.anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return browserClient;
}
