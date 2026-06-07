import { createContext } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import type { Profile } from '@/lib/profile';
import { supabase } from '@/lib/supabase';

export interface AuthState {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
}

export type AuthContextValue = AuthState & {
  signInWithDiscord: () => ReturnType<typeof supabase.auth.signInWithOAuth>;
  signInWithGoogle: () => ReturnType<typeof supabase.auth.signInWithOAuth>;
  signOut: () => ReturnType<typeof supabase.auth.signOut>;
  /** Re-fetch `profiles` row (e.g. after checkout returns `?upgraded=true`). */
  refreshProfile: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);
