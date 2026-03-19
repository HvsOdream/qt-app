import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// 클라이언트용 (브라우저) — 빌드 시점에는 빈 값으로 생성, 런타임에 정상 동작
let supabase: SupabaseClient;
if (supabaseUrl && supabaseAnonKey) {
  supabase = createClient(supabaseUrl, supabaseAnonKey);
} else {
  supabase = null as unknown as SupabaseClient;
}
export { supabase };

// 서버용 (API Routes에서 사용 — RLS 우회)
export function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY!;
  return createClient(url, serviceKey);
}

// ─── Auth 헬퍼 ───
export async function signInWithGoogle() {
  if (!supabase) return;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
    },
  });
  if (error) console.error('Google 로그인 오류:', error.message);
}

// 이메일 + 비밀번호 로그인
export async function signInWithPassword(email: string, password: string) {
  if (!supabase) return { error: 'Supabase 미설정' };
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  return { error: null };
}

// 이메일 + 비밀번호 회원가입
export async function signUpWithPassword(email: string, password: string) {
  if (!supabase) return { error: 'Supabase 미설정' };
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${window.location.origin}/auth/callback`,
    },
  });
  if (error) return { error: error.message };
  return { error: null };
}

// 비밀번호 재설정 메일 발송
export async function sendPasswordReset(email: string) {
  if (!supabase) return { error: 'Supabase 미설정' };
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/auth/reset-password`,
  });
  if (error) return { error: error.message };
  return { error: null };
}

// 새 비밀번호 저장 (reset 후 호출)
export async function updatePassword(newPassword: string) {
  if (!supabase) return { error: 'Supabase 미설정' };
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { error: error.message };
  return { error: null };
}

export async function signOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
}

export async function getUser() {
  if (!supabase) return null;
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export function onAuthStateChange(callback: (user: unknown) => void) {
  if (!supabase) return { data: { subscription: { unsubscribe: () => {} } } };
  return supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
}
