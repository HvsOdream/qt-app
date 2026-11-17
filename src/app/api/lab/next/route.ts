// GET /api/lab/next?exclude=id,id — 계속 풀기의 다음 문제 한 개
// 세트·남은 수 개념 없이 이어진다. 덜 풀어 본 문제를 먼저, 방금 푼 문제는 피한다.
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/teacher';
import { latestSession } from '@/lib/lab';

export async function GET(req: NextRequest) {
  const { user, supabase } = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 });

  const session = await latestSession(supabase, user.id);
  if (!session || session.checkout_at) {
    return NextResponse.json({ error: '입실 중이 아니에요' }, { status: 409 });
  }

  const { data, error } = await supabase
    .from('wrong_note')
    .select('id, subject, topic, question_text, choices, question_type, correct_answer, explanation, parent_id, times_wrong, times_correct')
    .eq('device_id', user.id)
    .eq('source', 'generated');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let pool = (data || []).filter((n) => n.question_type !== 'essay');
  // 오늘 고른 과목의 문제가 있으면 그 과목만
  const track = (session.track || '').trim();
  const inTrack = pool.filter((n) => (n.subject || '').trim() === track);
  if (track && inTrack.length) pool = inTrack;
  if (!pool.length) return NextResponse.json({ item: null });

  const exclude = new Set((new URL(req.url).searchParams.get('exclude') || '').split(',').filter(Boolean));
  const keep = Math.min(exclude.size, Math.max(0, pool.length - 1));
  const recent = [...exclude].slice(-keep);
  const fresh = pool.filter((n) => !recent.includes(n.id));
  let candidates = fresh.length ? fresh : pool;
  // 지지형: 추천 단원을 눌러 시작했으면 그 단원 문제를 먼저 낸다
  const prefer = (new URL(req.url).searchParams.get('prefer') || '').trim();
  if (session.condition === 'B' && prefer) {
    const preferred = candidates.filter((n) => ((n.topic || '').trim() || '단원 없음') === prefer);
    if (preferred.length) candidates = preferred;
  }

  const tries = (n: { times_wrong: number; times_correct: number }) => n.times_wrong + n.times_correct;
  const min = Math.min(...candidates.map(tries));
  const least = candidates.filter((n) => tries(n) === min);
  const item = least[Math.floor(Math.random() * least.length)];

  return NextResponse.json({
    item: {
      id: item.id, subject: item.subject, topic: item.topic, question_text: item.question_text,
      choices: item.choices || [], question_type: item.question_type,
      correct_answer: item.correct_answer, explanation: item.explanation, parent_id: item.parent_id,
    },
  });
}
