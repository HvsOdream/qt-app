// GET /api/teacher/overview?track_id= — 트랙 학습 현황 (요약, 단원별 정복률, 학생별 현황)
import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthUser, isTeacher, NOTE_COLUMNS, NoteRow,
  originalsOfTrack, childAttempts, lastActive, rate, unitRates,
} from '@/lib/teacher';

export async function GET(req: NextRequest) {
  const { user, supabase } = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 });
  if (!isTeacher(user)) return NextResponse.json({ error: '교수자 계정이 아닙니다' }, { status: 403 });

  const trackId = new URL(req.url).searchParams.get('track_id');
  if (!trackId) return NextResponse.json({ error: 'track_id 필요' }, { status: 400 });

  const { data: track } = await supabase
    .from('tracks').select('id, name, kind, join_code').eq('id', trackId).eq('owner_id', user.id).maybeSingle();
  if (!track) return NextResponse.json({ error: '트랙을 찾을 수 없습니다' }, { status: 404 });

  const [{ data: units }, { data: members }] = await Promise.all([
    supabase.from('track_units').select('title, order_no').eq('track_id', trackId).order('order_no'),
    supabase.from('track_members').select('user_id, joined_at').eq('track_id', trackId),
  ]);
  const memberIds = (members || []).map((m) => m.user_id);
  const unitTitles = (units || []).map((u) => u.title);

  let notes: NoteRow[] = [];
  if (memberIds.length) {
    const { data, error } = await supabase.from('wrong_note').select(NOTE_COLUMNS).in('device_id', memberIds);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    notes = (data || []) as NoteRow[];
  }

  // 이메일 표시용
  const emails = new Map<string, string>();
  if (memberIds.length) {
    const { data: usersResp } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    (usersResp?.users || []).forEach((u) => emails.set(u.id, u.email || ''));
  }

  const byUser = new Map<string, NoteRow[]>();
  notes.forEach((n) => {
    if (!byUser.has(n.device_id)) byUser.set(n.device_id, []);
    byUser.get(n.device_id)!.push(n);
  });

  const allOriginals: ReturnType<typeof originalsOfTrack> = [];
  let attempts = 0;
  const students = memberIds.map((id) => {
    const mine = byUser.get(id) || [];
    const originals = originalsOfTrack(mine, track.name);
    allOriginals.push(...originals);
    attempts += childAttempts(mine, originals).attempts;
    const done = originals.filter((o) => o.done).length;
    return {
      id,
      email: emails.get(id) || '(이메일 없음)',
      original_count: originals.length,
      done_count: done,
      rate: rate(done, originals.length),
      last_active_at: lastActive(originals.map((o) => o.note).concat(
        mine.filter((n) => n.source === 'generated' && originals.some((o) => o.note.id === n.parent_id)),
      )),
    };
  }).sort((a, b) => b.original_count - a.original_count);

  const totalDone = allOriginals.filter((o) => o.done).length;
  return NextResponse.json({
    track,
    totals: {
      members: memberIds.length,
      originals: allOriginals.length,
      attempts,
      rate: rate(totalDone, allOriginals.length),
    },
    units: unitRates(allOriginals, unitTitles),
    students,
  });
}
