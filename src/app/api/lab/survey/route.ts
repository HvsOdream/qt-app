// GET  /api/lab/survey — 입실 설문 문항과 이미 답한 문항
// POST /api/lab/survey — 문항 하나 응답 (즉시 survey 이벤트로 남긴다)
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/teacher';
import { ensureCondition, getParticipant, surveyItems, cleanAnswer } from '@/lib/lab';

async function answeredIds(supabase: ReturnType<typeof import('@/lib/supabase').getServiceClient>, userId: string) {
  const { data } = await supabase
    .from('lab_events').select('item_id, payload')
    .eq('user_id', userId).eq('type', 'survey').is('session_id', null);
  return new Set((data || []).map((r) => r.item_id as string));
}

export async function GET(req: NextRequest) {
  const { user, supabase } = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 });
  await ensureCondition(supabase, user.id);
  const p = await getParticipant(supabase, user.id);
  const items = (await surveyItems(supabase)).filter((i) => i.phase === 'in');
  const answered = await answeredIds(supabase, user.id);
  return NextResponse.json({
    done: !!p?.survey_done_at || items.length === 0,
    items: items.map((i) => ({
      id: i.id, text: i.text_ko, type: i.response_type, min_label: i.min_label, max_label: i.max_label, unit: i.unit,
    })),
    answered: [...answered],
  });
}

export async function POST(req: NextRequest) {
  const { user, supabase } = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const condition = await ensureCondition(supabase, user.id);
  const items = (await surveyItems(supabase)).filter((i) => i.phase === 'in');
  const item = items.find((i) => i.id === body.item_id);
  if (!item) return NextResponse.json({ error: '없는 문항이에요' }, { status: 400 });
  const value = cleanAnswer(item, body.value);
  if (value === null) return NextResponse.json({ error: '응답을 다시 골라 주세요' }, { status: 400 });

  const answered = await answeredIds(supabase, user.id);
  if (!answered.has(item.id)) {
    const { error } = await supabase.from('lab_events').insert({
      user_id: user.id, session_id: null, condition, type: 'survey', item_id: item.id,
      payload: { scale: item.scale, item: item.item_no, value, phase: 'in' },
      t_ms_client: typeof body.t_ms_client === 'number' ? Math.round(body.t_ms_client) : null,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    answered.add(item.id);
  }
  const done = items.every((i) => answered.has(i.id));
  if (done) {
    await supabase.from('lab_participants')
      .update({ survey_done_at: new Date().toISOString() }).eq('user_id', user.id).is('survey_done_at', null);
  }
  return NextResponse.json({ done });
}
