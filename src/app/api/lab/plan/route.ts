// POST /api/lab/plan — 오늘 계획 저장 (= 입실, T0). 저장 뒤에는 고칠 수 없다.
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, isTeacher } from '@/lib/teacher';
import { ensureCondition, getParticipant, latestSession, logEvent, publicSession, surveyItems, LabSession } from '@/lib/lab';

export async function POST(req: NextRequest) {
  const { user, supabase } = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const minutes = Math.round(Number(body.minutes));
  const track = typeof body.track === 'string' ? body.track.trim().slice(0, 60) : '';
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 600) {
    return NextResponse.json({ error: '공부할 시간을 1~600분 사이로 적어 주세요' }, { status: 400 });
  }

  const last = await latestSession(supabase, user.id);
  if (last && !last.checkout_at) {
    // 이미 입실해 있으면 그 계획을 그대로 쓴다
    return NextResponse.json({ session: publicSession(last) });
  }
  if (last && last.checkout_at && !(isTeacher(user) && body.restart === true)) {
    return NextResponse.json({ error: '오늘 참여는 이미 끝났어요' }, { status: 409 });
  }

  let condition = await ensureCondition(supabase, user.id);
  const participant = await getParticipant(supabase, user.id);
  // 입실 설문을 마쳐야 계획을 적을 수 있다
  const hasSurvey = (await surveyItems(supabase)).some((i) => i.phase === 'in');
  if (hasSurvey && !participant?.survey_done_at && !(isTeacher(user) && body.restart === true)) {
    return NextResponse.json({ error: '입실 설문을 먼저 마쳐 주세요' }, { status: 409 });
  }
  // 코드로 들어온 참여자는 자기 블록이 열려 있을 때만 입실할 수 있다
  if (participant?.block_id) {
    const { data: block } = await supabase
      .from('lab_blocks').select('opened_at, closed_at').eq('id', participant.block_id).maybeSingle();
    if (!block?.opened_at || block?.closed_at) {
      return NextResponse.json({ error: '지금은 학습실이 열려 있지 않아요' }, { status: 409 });
    }
  }
  // 관리자 테스트: 화면 종류를 골라 새 세션을 열 수 있다 (참여자 배정에는 영향 없음)
  if (isTeacher(user) && body.restart === true && ['A', 'B', 'C'].includes(body.condition)) {
    condition = body.condition;
  }
  const { data, error } = await supabase
    .from('lab_sessions')
    .insert({ user_id: user.id, condition, track: track || null, plan_minutes: minutes, block_id: participant?.block_id || null })
    .select().single();
  if (error || !data) return NextResponse.json({ error: error?.message || '저장 실패' }, { status: 500 });

  const session = data as LabSession;
  await logEvent(supabase, session, 'plan', { minutes, track: track || null },
    null, typeof body.t_ms_client === 'number' ? body.t_ms_client : null);
  return NextResponse.json({ session: publicSession(session) });
}
