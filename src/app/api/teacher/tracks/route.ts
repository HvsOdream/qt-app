// GET  /api/teacher/tracks — 내 학습 트랙 목록
// POST /api/teacher/tracks — 학습 트랙 만들기 (단원 포함, 참여 코드 자동 생성)
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, isTeacher, makeJoinCode } from '@/lib/teacher';

const KINDS = ['class', 'cert', 'personal'];

export async function GET(req: NextRequest) {
  const { user, supabase } = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 });
  if (!isTeacher(user)) return NextResponse.json({ error: '교수자 계정이 아닙니다' }, { status: 403 });

  const { data: tracks, error } = await supabase
    .from('tracks')
    .select('id, name, kind, join_code, created_at')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (tracks || []).map((t) => t.id);
  const unitCount = new Map<string, number>();
  const memberCount = new Map<string, number>();
  if (ids.length) {
    const [{ data: units }, { data: members }] = await Promise.all([
      supabase.from('track_units').select('track_id').in('track_id', ids),
      supabase.from('track_members').select('track_id').in('track_id', ids),
    ]);
    (units || []).forEach((u) => unitCount.set(u.track_id, (unitCount.get(u.track_id) || 0) + 1));
    (members || []).forEach((m) => memberCount.set(m.track_id, (memberCount.get(m.track_id) || 0) + 1));
  }

  return NextResponse.json({
    tracks: (tracks || []).map((t) => ({
      ...t,
      unit_count: unitCount.get(t.id) || 0,
      member_count: memberCount.get(t.id) || 0,
    })),
  });
}

export async function POST(req: NextRequest) {
  const { user, supabase } = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 });
  if (!isTeacher(user)) return NextResponse.json({ error: '교수자 계정이 아닙니다' }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { name?: string; kind?: string; units?: string[] };
  const name = (body.name || '').trim();
  const kind = KINDS.includes(body.kind || '') ? body.kind! : 'class';
  const units = (body.units || []).map((u) => u.trim()).filter(Boolean);
  if (!name) return NextResponse.json({ error: '트랙 이름을 입력해 주세요' }, { status: 400 });

  // 참여 코드가 겹치면 다시 만든다 (최대 5회)
  let track: { id: string; name: string; kind: string; join_code: string; created_at: string } | null = null;
  let lastError = '';
  for (let i = 0; i < 5 && !track; i++) {
    const { data, error } = await supabase
      .from('tracks')
      .insert({ owner_id: user.id, name, kind, join_code: makeJoinCode() })
      .select('id, name, kind, join_code, created_at')
      .single();
    if (data) track = data;
    else lastError = error?.message || '';
  }
  if (!track) return NextResponse.json({ error: lastError || '트랙을 만들지 못했습니다' }, { status: 500 });

  if (units.length) {
    const { error } = await supabase
      .from('track_units')
      .insert(units.map((title, i) => ({ track_id: track!.id, order_no: i + 1, title })));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ track: { ...track, unit_count: units.length, member_count: 0 } });
}
