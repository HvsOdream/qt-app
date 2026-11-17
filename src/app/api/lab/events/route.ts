// POST /api/lab/events — 화면에서 생긴 이벤트를 묶어서 저장
// 조건·과목은 서버가 세션에서 읽어 붙인다. 퇴실 뒤에 온 이벤트는 받지 않는다.
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/teacher';
import { latestSession } from '@/lib/lab';

const ALLOWED = new Set([
  'app_fg', 'app_bg', 'item_shown', 'item_answered', 'practice_start', 'practice_stop',
  'checkout_open', 'checkout_cancel', 'capture_open', 'element',
]);

export async function POST(req: NextRequest) {
  const { user, supabase } = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const events = Array.isArray(body.events) ? body.events.slice(0, 200) : [];
  const session = await latestSession(supabase, user.id);
  if (!session) return NextResponse.json({ error: '입실 기록이 없어요' }, { status: 409 });

  const rows = events
    .filter((e: { type?: string }) => typeof e?.type === 'string' && ALLOWED.has(e.type))
    .map((e: { type: string; item_id?: string; payload?: Record<string, unknown>; t_ms_client?: number }) => ({
      user_id: user.id,
      session_id: session.id,
      condition: session.condition,
      track: session.track,
      type: e.type,
      item_id: typeof e.item_id === 'string' ? e.item_id : null,
      payload: e.payload && typeof e.payload === 'object' ? e.payload : {},
      t_ms_client: typeof e.t_ms_client === 'number' ? Math.round(e.t_ms_client) : null,
    }))
    // 퇴실 확정 뒤에 생긴 이벤트는 버린다 (그 전에 생겨 늦게 도착한 것은 받는다)
    .filter((r: { t_ms_client: number | null }) =>
      !session.checkout_at || (r.t_ms_client !== null && r.t_ms_client <= new Date(session.checkout_at).getTime()));

  if (!rows.length) return NextResponse.json({ saved: 0 });
  const { error } = await supabase.from('lab_events').insert(rows);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ saved: rows.length });
}
