import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      question_text,
      choices,
      correct_answer,
      student_answer,
      is_correct,
      subject,
      topic,
      keywords,
      wrong_answer_id,
      question_bank_id,
    } = body;

    const supabase = getServiceClient();

    await supabase.from('quiz_results').insert({
      question_text,
      choices: choices || [],
      correct_answer,
      student_answer,
      is_correct,
      subject: subject || null,
      topic: topic || null,
      keywords: keywords || [],
      wrong_answer_id: wrong_answer_id || null,
      question_bank_id: question_bank_id || null,
    });

    // question_bank 통계 업데이트
    if (question_bank_id) {
      try {
        await supabase.rpc('increment_question_stats', {
          qb_id: question_bank_id,
          was_correct: is_correct,
        });
      } catch (statsError) {
        console.error('문제 통계 업데이트 실패:', statsError);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('결과 저장 오류:', error);
    return NextResponse.json(
      { error: '결과 저장 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
