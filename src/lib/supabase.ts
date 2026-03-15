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
