// GET /api/track/mine — 내가 참여한 학습 트랙과 단원 (단원 입력 화면의 추천 칩에 사용)
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/teacher';

export async function GET(req: NextRequest) {
  const { user, supabase } = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 });

  const { data: members, error } = await supabase
    .from('track_members').select('track_id').eq('user_id', user.id);
  // 트랙 테이블이 아직 없으면 빈 목록으로 답한다 (학생 앱은 그대로 동작)
  if (error) return NextResponse.json({ tracks: [] });

  const ids = (members || []).map((m) => m.track_id);
  if (!ids.length) return NextResponse.json({ tracks: [] });

  const [{ data: tracks }, { data: units }] = await Promise.all([
    supabase.from('tracks').select('id, name, kind').in('id', ids).order('created_at'),
    supabase.from('track_units').select('track_id, title, order_no').in('track_id', ids).order('order_no'),
  ]);

  return NextResponse.json({
    tracks: (tracks || []).map((t) => ({
      ...t,
      units: (units || []).filter((u) => u.track_id === t.id).map((u) => u.title),
    })),
  });
}
