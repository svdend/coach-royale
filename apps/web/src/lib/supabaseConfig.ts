export const TEMPLATE_SUPABASE_URL = 'https://your-project.supabase.co';
export const TEMPLATE_SUPABASE_ANON_KEY = 'your-anon-key';

interface SupabaseConfigInput {
  mode: string;
  url?: string;
  anonKey?: string;
}

interface ResolvedSupabaseConfig {
  url: string;
  anonKey: string;
  usingTemplateDefaults: boolean;
}

function isTemplateValue(url: string | undefined, anonKey: string | undefined): boolean {
  return url === TEMPLATE_SUPABASE_URL || anonKey === TEMPLATE_SUPABASE_ANON_KEY;
}

export function resolveSupabaseConfig(input: SupabaseConfigInput): ResolvedSupabaseConfig {
  const url = input.url?.trim();
  const anonKey = input.anonKey?.trim();
  const hasConcreteConfig = Boolean(url) && Boolean(anonKey) && !isTemplateValue(url, anonKey);

  if (hasConcreteConfig) {
    return {
      url: url as string,
      anonKey: anonKey as string,
      usingTemplateDefaults: false,
    };
  }

  const isLocalMode = input.mode === 'development' || input.mode === 'test';
  if (isLocalMode) {
    return {
      url: TEMPLATE_SUPABASE_URL,
      anonKey: TEMPLATE_SUPABASE_ANON_KEY,
      usingTemplateDefaults: true,
    };
  }

  throw new Error(
    '[declaw] Supabase env missing or still using template defaults. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY before building this deployment.',
  );
}
