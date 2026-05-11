// PATCH /api/wrong-note/attempt — 퀴즈 결과 반영
// 맞으면 times_correct++, 틀리면 times_wrong++
// times_correct >= 3 이면 mastered = true
// 자식이 모두 mastered되면 부모도 자동 mastered cascade
import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

const MASTER_THRESHOLD = 3; // 누적 정답 수

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

  // 부모 mastered cascade를 위해 새로 mastered된 자식의 parent_id 수집
  const newlyMasteredParents = new Set<string>();

  for (const attempt of attempts) {
    // 현재 값 + parent_id 조회
    const { data: current, error: fetchErr } = await supabase
      .from('wrong_note')
      .select('times_wrong, times_correct, mastered, parent_id')
      .eq('id', attempt.id)
      .single();

    if (fetchErr || !current) continue;

    const newWrong   = current.times_wrong   + (attempt.is_correct ? 0 : 1);
    const newCorrect = current.times_correct + (attempt.is_correct ? 1 : 0);
    const newMastered = newCorrect >= MASTER_THRESHOLD;
    const becameMastered = newMastered && !current.mastered;

    await supabase
      .from('wrong_note')
      .update({
        times_wrong:       newWrong,
        times_correct:     newCorrect,
        mastered:          newMastered,
        last_attempted_at: now,
      })
      .eq('id', attempt.id);

    results.push({ id: attempt.id, mastered: newMastered });

    if (becameMastered && current.parent_id) {
      newlyMasteredParents.add(current.parent_id);
    }
  }

  // ─── 부모 자동 mastered cascade ───
  // 자식이 모두 mastered된 부모는 자동으로 mastered=true 처리
  const cascaded: string[] = [];
  for (const parentId of newlyMasteredParents) {
    const { data: siblings, error: sErr } = await supabase
      .from('wrong_note')
      .select('id, mastered')
      .eq('parent_id', parentId);

    if (sErr || !siblings || siblings.length === 0) continue;
    const allMastered = siblings.every(s => s.mastered);
    if (!allMastered) continue;

    await supabase
      .from('wrong_note')
      .update({ mastered: true, last_attempted_at: now })
      .eq('id', parentId);
    cascaded.push(parentId);
  }

  return NextResponse.json({ updated: results, cascadedParents: cascaded });
}
