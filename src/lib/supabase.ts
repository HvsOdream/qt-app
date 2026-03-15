import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// 클라이언트용 (브라우저)
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// 서버용 (API Routes에서 사용 — RLS 우회)
export function getServiceClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_KEY!;
  return createClient(supabaseUrl, serviceKey);
}
