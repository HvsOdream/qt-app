// GET /api/lab/state — 내 세션 상태, 과목 후보, 오늘 찍은 문제
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, isTeacher } from '@/lib/teacher';
import { ensureCondition, getParticipant, latestSession, logEvent, publicSession, surveyItems } from '@/lib/lab';

export async function GET(req: NextRequest) {
  const { user, supabase } = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 });

  try {
    await ensureCondition(supabase, user.id);
  } catch (e) {
    return NextResponse.json({ error: `학습실 준비가 안 됐어요 (${(e as Error).message})` }, { status: 500 });
  }
  const session = await latestSession(supabase, user.id);

  // 과목 후보: 내 오답노트의 과목 + 참여한 학습 트랙
  const { data: notes } = await supabase
    .from('wrong_note')
    .select('id, subject, topic, question_text, source, parent_id, created_at')
    .eq('device_id', user.id)
    .order('created_at', { ascending: false });
  const subjects = new Set<string>();
  (notes || []).forEach((n) => { if (n.subject?.trim()) subjects.add(n.subject.trim()); });
  const { data: members } = await supabase.from('track_members').select('track_id').eq('user_id', user.id);
  const ids = (members || []).map((m) => m.track_id);
  if (ids.length) {
    const { data: tracks } = await supabase.from('tracks').select('name').in('id', ids);
    (tracks || []).forEach((t) => subjects.add(t.name));
  }

  // 오늘 찍은 문제: 입실(계획 저장) 뒤에 스캔으로 들어온 원본
  let captured: { id: string; question_text: string; topic: string | null; similar: number }[] = [];
  const poolSize = (notes || []).filter((n) => n.source === 'generated').length;
  if (session) {
    const all = notes || [];
    const scans = all.filter((n) => n.source === 'scan' && n.created_at >= session.plan_at);
    captured = scans.map((n) => ({
      id: n.id, question_text: n.question_text, topic: n.topic,
      similar: all.filter((c) => c.source === 'generated' && c.parent_id === n.id).length,
    }));

    // 촬영 로그: 아직 기록되지 않은 원본만 한 번씩 남긴다
    if (!session.checkout_at && scans.length) {
      const { data: logged } = await supabase
        .from('lab_events').select('item_id').eq('session_id', session.id).eq('type', 'capture');
      const seen = new Set((logged || []).map((l) => l.item_id));
      for (const n of scans) {
        if (!seen.has(n.id)) {
          await logEvent(supabase, session, 'capture', { unit: n.topic, saved_at: n.created_at }, n.id);
        }
      }
    }
  }

  // 설문·블록 상태
  const participant = await getParticipant(supabase, user.id);
  const allItems = await surveyItems(supabase);
  const inItems = allItems.filter((i) => i.phase === 'in');
  const surveyNeeded = inItems.length > 0 && !participant?.survey_done_at;
  let blockOpen = true; // 코드 없이 들어온 계정(교수자·일반)은 블록과 무관하게 쓸 수 있다
  if (participant?.block_id) {
    const { data: block } = await supabase
      .from('lab_blocks').select('opened_at, closed_at').eq('id', participant.block_id).maybeSingle();
    blockOpen = !!block?.opened_at && !block?.closed_at;
  }
  // 퇴실 때 묻는 문항: 입실과 같은 문항(also_out) → 퇴실 전용(out) → 조작점검(mc)
  const pub = (i: (typeof allItems)[number]) => ({
    id: i.id, text: i.text_ko, type: i.response_type, min_label: i.min_label, max_label: i.max_label, unit: i.unit,
  });
  const outItems = [
    ...inItems.filter((i) => i.also_out),
    ...allItems.filter((i) => i.phase === 'out'),
    ...allItems.filter((i) => i.phase === 'mc'),
  ].map(pub);

  return NextResponse.json({
    surveyNeeded,
    blockOpen,
    outItems,
    code: participant?.research_code || null,
    session: publicSession(session),
    subjects: [...subjects],
    captured,
    hasPool: poolSize > 0,
    canReset: isTeacher(user),
  });
}
