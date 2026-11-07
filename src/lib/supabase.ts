import { createClient } from '@supabase/supabase-js';

// Acepta también la URL copiada de Data API (".../rest/v1/") o con "/" final.
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && anonKey);

// Solo la clave anon pública. Nunca la service_role en el front.
export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'missing-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true },
});
