// GET /api/teacher/student?track_id=&user_id= — 학생 한 명의 트랙 학습 상세
import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthUser, isTeacher, NOTE_COLUMNS, NoteRow,
  originalsOfTrack, childAttempts, lastActive, rate, unitRates,
} from '@/lib/teacher';

export async function GET(req: NextRequest) {
  const { user, supabase } = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 });
  if (!isTeacher(user)) return NextResponse.json({ error: '교수자 계정이 아닙니다' }, { status: 403 });

  const params = new URL(req.url).searchParams;
  const trackId = params.get('track_id');
  const studentId = params.get('user_id');
  if (!trackId || !studentId) return NextResponse.json({ error: 'track_id, user_id 필요' }, { status: 400 });

  const { data: track } = await supabase
    .from('tracks').select('id, name').eq('id', trackId).eq('owner_id', user.id).maybeSingle();
  if (!track) return NextResponse.json({ error: '트랙을 찾을 수 없습니다' }, { status: 404 });

  // 이 트랙에 참여한 학생만 조회할 수 있다
  const { data: member } = await supabase
    .from('track_members').select('user_id').eq('track_id', trackId).eq('user_id', studentId).maybeSingle();
  if (!member) return NextResponse.json({ error: '이 트랙에 참여한 학생이 아닙니다' }, { status: 404 });

  const [{ data: units }, { data: notesRaw, error }, { data: studentResp }] = await Promise.all([
    supabase.from('track_units').select('title, order_no').eq('track_id', trackId).order('order_no'),
    supabase.from('wrong_note').select(NOTE_COLUMNS).eq('device_id', studentId),
    supabase.auth.admin.getUserById(studentId),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const notes = (notesRaw || []) as NoteRow[];
  const originals = originalsOfTrack(notes, track.name);
  const { attempts, correct } = childAttempts(notes, originals);
  const done = originals.filter((o) => o.done).length;
  const related = originals.map((o) => o.note).concat(
    notes.filter((n) => n.source === 'generated' && originals.some((o) => o.note.id === n.parent_id)),
  );

  return NextResponse.json({
    student: { id: studentId, email: studentResp?.user?.email || '(이메일 없음)' },
    totals: {
      originals: originals.length,
      done,
      accuracy: rate(correct, attempts),
      last_active_at: lastActive(related),
    },
    units: unitRates(originals, (units || []).map((u) => u.title)),
    problems: originals
      .sort((a, b) => new Date(b.note.created_at).getTime() - new Date(a.note.created_at).getTime())
      .slice(0, 30)
      .map((o) => ({
        id: o.note.id,
        question_text: o.note.question_text,
        topic: o.note.topic,
        child_count: o.childCount,
        child_mastered: o.childMastered,
        status: o.done ? 'done' : o.childCount === 0 ? 'none' : 'learning',
      })),
  });
}
