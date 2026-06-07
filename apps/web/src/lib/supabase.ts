import { createClient } from '@supabase/supabase-js';
import {
  resolveSupabaseConfig,
  TEMPLATE_SUPABASE_ANON_KEY,
  TEMPLATE_SUPABASE_URL,
} from './supabaseConfig';

const {
  url: supabaseUrl,
  anonKey: supabaseAnonKey,
  usingTemplateDefaults,
} = resolveSupabaseConfig({
  mode: import.meta.env.MODE,
  url: import.meta.env.VITE_SUPABASE_URL,
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
});

// Only nag in the Vite dev server — not during `vitest` (MODE === 'test').
if (import.meta.env.MODE === 'development' && usingTemplateDefaults) {
  console.error(
    `[declaw] Supabase env missing or still using template defaults (${TEMPLATE_SUPABASE_URL}, ${TEMPLATE_SUPABASE_ANON_KEY}). Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see .env.example).`,
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
