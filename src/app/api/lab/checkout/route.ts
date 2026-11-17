// POST /api/lab/checkout — 퇴실 확정. 한 번 확정하면 되돌릴 수 없다.
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/teacher';
import { latestSession, logEvent, publicSession, LabSession } from '@/lib/lab';

const REASONS = new Set(['plan_done', 'tired', 'bored', 'other_task', 'etc']);

export async function POST(req: NextRequest) {
  const { user, supabase } = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === 'string' && REASONS.has(body.reason) ? body.reason : null;
  const fatigue = Math.round(Number(body.fatigue));
  if (!reason || !(fatigue >= 1 && fatigue <= 5)) {
    return NextResponse.json({ error: '이유와 지친 정도를 골라 주세요' }, { status: 400 });
  }

  const session = await latestSession(supabase, user.id);
  if (!session) return NextResponse.json({ error: '입실 기록이 없어요' }, { status: 409 });
  if (session.checkout_at) return NextResponse.json({ session: publicSession(session) });

  const now = new Date();
  const { data, error } = await supabase
    .from('lab_sessions')
    .update({ checkout_at: now.toISOString(), checkout_source: 'button', reason, fatigue })
    .eq('id', session.id).is('checkout_at', null)
    .select().single();
  if (error || !data) return NextResponse.json({ error: error?.message || '저장 실패' }, { status: 500 });

  const done = data as LabSession;
  const stayed = Math.round((now.getTime() - new Date(done.plan_at).getTime()) / 6000) / 10;
  await logEvent(supabase, done, 'checkout', { reason, fatigue, minutes_stayed: stayed },
    null, typeof body.t_ms_client === 'number' ? body.t_ms_client : null);
  return NextResponse.json({ session: publicSession(done) });
}
