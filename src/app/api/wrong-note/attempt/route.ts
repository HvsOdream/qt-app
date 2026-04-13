// PATCH /api/wrong-note/attempt — 퀴즈 결과 반영
// 맞으면 times_correct++, 틀리면 times_wrong++
// times_correct >= 3 이면 mastered = true
import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

const MASTER_THRESHOLD = 3; // 연속이 아닌 누적 정답 수

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { attempts } = body as {
    attempts: { id: string; is_correct: boolean }[];
  };

  if (!attempts?.length) {
    return NextResponse.json({ error: 'attempts 배열 필요' }, { status: 400 });
  }

  const supabase = getServiceClient();
  const now = new Date().toISOString();
  const results: { id: string; mastered: boolean }[] = [];

  for (const attempt of attempts) {
    // 현재 값 조회
    const { data: current, error: fetchErr } = await supabase
      .from('wrong_note')
      .select('times_wrong, times_correct, mastered')
      .eq('id', attempt.id)
      .single();

    if (fetchErr || !current) continue;

    const newWrong   = current.times_wrong   + (attempt.is_correct ? 0 : 1);
    const newCorrect = current.times_correct + (attempt.is_correct ? 1 : 0);
    const newMastered = newCorrect >= MASTER_THRESHOLD;

    await supabase
      .from('wrong_note')
      .update({
        times_wrong:      newWrong,
        times_correct:    newCorrect,
        mastered:         newMastered,
        last_attempted_at: now,
      })
      .eq('id', attempt.id);

    results.push({ id: attempt.id, mastered: newMastered });
  }

  return NextResponse.json({ updated: results });
}
