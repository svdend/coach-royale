import { describe, expect, it } from 'vitest';

import {
  resolveSupabaseConfig,
  TEMPLATE_SUPABASE_ANON_KEY,
  TEMPLATE_SUPABASE_URL,
} from '../supabaseConfig';

describe('resolveSupabaseConfig', () => {
  it('returns concrete values when provided', () => {
    expect(
      resolveSupabaseConfig({
        mode: 'production',
        url: 'https://peikfsucsmddouyaludw.supabase.co',
        anonKey: 'sb_publishable_live',
      }),
    ).toEqual({
      url: 'https://peikfsucsmddouyaludw.supabase.co',
      anonKey: 'sb_publishable_live',
      usingTemplateDefaults: false,
    });
  });

  it('returns template defaults in development when config is missing', () => {
    expect(resolveSupabaseConfig({ mode: 'development' })).toEqual({
      url: TEMPLATE_SUPABASE_URL,
      anonKey: TEMPLATE_SUPABASE_ANON_KEY,
      usingTemplateDefaults: true,
    });
  });

  it('returns template defaults in test mode when config is missing', () => {
    expect(resolveSupabaseConfig({ mode: 'test' })).toEqual({
      url: TEMPLATE_SUPABASE_URL,
      anonKey: TEMPLATE_SUPABASE_ANON_KEY,
      usingTemplateDefaults: true,
    });
  });

  it('throws in production when config is missing', () => {
    expect(() => resolveSupabaseConfig({ mode: 'production' })).toThrow(
      /Supabase env missing or still using template defaults/,
    );
  });

  it('throws in production when explicit template values are used', () => {
    expect(() =>
      resolveSupabaseConfig({
        mode: 'production',
        url: TEMPLATE_SUPABASE_URL,
        anonKey: TEMPLATE_SUPABASE_ANON_KEY,
      }),
    ).toThrow(/Supabase env missing or still using template defaults/);
  });
});
