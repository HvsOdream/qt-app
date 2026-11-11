// POST /api/track/join — 학생이 참여 코드로 학습 트랙에 참여
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/teacher';

export async function POST(req: NextRequest) {
  const { user, supabase } = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { code?: string };
  const code = (body.code || '').trim().toUpperCase();
  if (!code) return NextResponse.json({ error: '참여 코드를 입력해 주세요' }, { status: 400 });

  const { data: track } = await supabase
    .from('tracks').select('id, name, kind').eq('join_code', code).maybeSingle();
  if (!track) return NextResponse.json({ error: '참여 코드를 찾을 수 없어요' }, { status: 404 });

  const { error } = await supabase
    .from('track_members')
    .upsert({ track_id: track.id, user_id: user.id }, { onConflict: 'track_id,user_id', ignoreDuplicates: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ track });
}
