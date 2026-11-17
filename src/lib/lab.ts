// 자율 학습실(실험 테스트베드) 서버 공통
import type { SupabaseClient } from '@supabase/supabase-js';

export type Condition = 'A' | 'B' | 'C';
const CONDITIONS: Condition[] = ['A', 'B', 'C'];

export interface LabSession {
  id: string;
  user_id: string;
  condition: Condition;
  track: string | null;
  plan_minutes: number;
  plan_at: string;
  checkout_at: string | null;
  checkout_source: string | null;
  reason: string | null;
  fatigue: number | null;
}

// 조건 배정: 지금까지 가장 적게 배정된 조건 중에서 무작위. 한 번 정하면 바꾸지 않는다.
export async function ensureCondition(supabase: SupabaseClient, userId: string): Promise<Condition> {
  const { data: mine } = await supabase
    .from('lab_participants').select('condition').eq('user_id', userId).maybeSingle();
  if (mine?.condition) return mine.condition as Condition;

  const { data: all } = await supabase.from('lab_participants').select('condition');
  const counts: Record<Condition, number> = { A: 0, B: 0, C: 0 };
  (all || []).forEach((r) => { if (r.condition in counts) counts[r.condition as Condition] += 1; });
  const min = Math.min(...CONDITIONS.map((c) => counts[c]));
  const pool = CONDITIONS.filter((c) => counts[c] === min);
  const picked = pool[Math.floor(Math.random() * pool.length)];

  const { error } = await supabase.from('lab_participants').insert({ user_id: userId, condition: picked });
  if (error) {
    // 동시에 두 번 들어온 경우: 먼저 저장된 값을 쓴다
    const { data: again } = await supabase
      .from('lab_participants').select('condition').eq('user_id', userId).maybeSingle();
    if (again?.condition) return again.condition as Condition;
    throw new Error(error.message);
  }
  return picked;
}

// 가장 최근 세션 (없으면 null)
export async function latestSession(supabase: SupabaseClient, userId: string): Promise<LabSession | null> {
  const { data } = await supabase
    .from('lab_sessions').select('*').eq('user_id', userId)
    .order('plan_at', { ascending: false }).limit(1).maybeSingle();
  return (data as LabSession) || null;
}

export async function logEvent(
  supabase: SupabaseClient,
  s: Pick<LabSession, 'id' | 'user_id' | 'condition' | 'track'>,
  type: string,
  payload: Record<string, unknown> = {},
  itemId: string | null = null,
  tMsClient: number | null = null,
) {
  await supabase.from('lab_events').insert({
    user_id: s.user_id, session_id: s.id, condition: s.condition, track: s.track,
    type, item_id: itemId, payload, t_ms_client: tMsClient,
  });
}

// 화면에 내려보내는 세션: 조건은 빼고 준다 (1차는 전원 디폴트 화면)
export function publicSession(s: LabSession | null) {
  if (!s) return null;
  return {
    id: s.id, track: s.track, plan_minutes: s.plan_minutes,
    plan_at: s.plan_at, checkout_at: s.checkout_at,
  };
}
