import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export async function DELETE() {
  try {
    const supabase = getServiceClient();

    // quiz_results 전체 삭제
    const { error: e1 } = await supabase
      .from('quiz_results')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // 전체 삭제 트릭

    // question_bank 전체 삭제
    const { error: e2 } = await supabase
      .from('question_bank')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (e1 || e2) {
      console.error('reset-db 오류:', e1, e2);
      return NextResponse.json({ error: '초기화 실패' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, message: '데이터 초기화 완료' });
  } catch (err) {
    console.error('reset-db 예외:', err);
    return NextResponse.json({ error: '초기화 오류' }, { status: 500 });
  }
}
