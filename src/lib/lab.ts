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
  block_id?: string | null;
}

export interface Participant {
  user_id: string;
  condition: Condition;
  block_id: string | null;
  research_code: string | null;
  survey_done_at: string | null;
}

export interface SurveyItem {
  id: string; scale: string; item_no: number; text_ko: string; response_type: string;
  phase: string; also_out: boolean; min_label: string | null; max_label: string | null; unit: string | null; sort: number;
}

export async function getParticipant(supabase: SupabaseClient, userId: string): Promise<Participant | null> {
  const { data } = await supabase
    .from('lab_participants').select('user_id, condition, block_id, research_code, survey_done_at')
    .eq('user_id', userId).maybeSingle();
  return (data as Participant) || null;
}

export async function surveyItems(supabase: SupabaseClient): Promise<SurveyItem[]> {
  const { data } = await supabase
    .from('lab_survey_items')
    .select('id, scale, item_no, text_ko, response_type, phase, also_out, min_label, max_label, unit, sort')
    .order('sort').order('scale').order('item_no');
  return (data || []) as SurveyItem[];
}

// 응답 값이 문항 유형에 맞는지 확인하고 저장할 값으로 바꾼다 (맞지 않으면 null)
export function cleanAnswer(item: SurveyItem, value: unknown): string | number | null {
  const t = item.response_type;
  if (t.startsWith('likert')) {
    const max = Number(t.slice(6)); const n = Math.round(Number(value));
    return n >= 1 && n <= max ? n : null;
  }
  if (t === 'number') {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 && n <= 1000 ? Math.round(n * 10) / 10 : null;
  }
  if (t === 'yesno') return value === 'yes' || value === 'no' ? value : null;
  if (t === 'date') return value === 'undecided' || /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? String(value) : null;
  return null;
}

// 연구용 익명 코드로 만든 계정의 로그인용 주소 (메일은 보내지 않는다)
export const CODE_EMAIL_DOMAIN = 'lab.bloomlens.invalid';
export const codeEmail = (code: string) => `${code.trim().toLowerCase()}@${CODE_EMAIL_DOMAIN}`;

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
