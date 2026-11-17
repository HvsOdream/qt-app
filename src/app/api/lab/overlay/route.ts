// GET /api/lab/overlay — 조건별 요소 값. 조건은 서버가 세션에서 읽는다(화면은 캐시하지 않는다).
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/teacher';
import { latestSession } from '@/lib/lab';
import { buildOverlay } from '@/lib/lab-overlay';

export async function GET(req: NextRequest) {
  const { user, supabase } = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 });
  const session = await latestSession(supabase, user.id);
  if (!session) return NextResponse.json({ kind: null });
  const overlay = await buildOverlay(supabase, session);
  return NextResponse.json(overlay, { headers: { 'Cache-Control': 'no-store' } });
}
