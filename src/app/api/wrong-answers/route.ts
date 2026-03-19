import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export async function GET() {
  try {
    const supabase = getServiceClient();

    // 오답 목록 조회 (최신순, 50개)
    const { data: wrongAnswers, error } = await supabase
      .from('quiz_results')
      .select('question_text, choices, correct_answer, subject, topic, keywords, question_bank_id, created_at, student_answer')
      .eq('is_correct', false)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('오답 조회 오류:', error);
      return NextResponse.json({ error: '오답노트 조회 실패' }, { status: 500 });
    }

    // question_text 기준 중복 제거 (최신 오답만 유지)
    const seen = new Set<string>();
    const unique = (wrongAnswers || []).filter(w => {
      const key = w.question_text?.slice(0, 50) ?? '';
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // question_bank_id가 있는 문제는 bank에서 explanation 포함 전체 데이터 가져오기
    const bankIds = unique
      .filter(w => w.question_bank_id)
      .map(w => w.question_bank_id as string);

    const bankMap: Record<string, Record<string, unknown>> = {};
    if (bankIds.length > 0) {
      const { data: bankData } = await supabase
        .from('question_bank')
        .select('*')
        .in('id', bankIds);
      bankData?.forEach(p => { bankMap[p.id] = p; });
    }

    // 오답 이력 카운트 (문제별 몇 번 틀렸는지)
    const { data: countData } = await supabase
      .from('quiz_results')
      .select('question_text')
      .eq('is_correct', false);

    const wrongCountMap: Record<string, number> = {};
    countData?.forEach(r => {
      const key = r.question_text?.slice(0, 50) ?? '';
      wrongCountMap[key] = (wrongCountMap[key] || 0) + 1;
    });

    // 최종 병합
    type MergedProblem = Record<string, unknown> & { subject?: unknown };
    const problems: MergedProblem[] = unique.map(w => {
      const bankProblem = w.question_bank_id ? bankMap[w.question_bank_id] : null;
      const base: MergedProblem = bankProblem ?? {
        question_text: w.question_text,
        choices: w.choices,
        correct_answer: w.correct_answer,
        explanation: '',
        subject: w.subject,
        topic: w.topic,
        keywords: w.keywords,
        bloom_level: 2,
      };
      return {
        ...base,
        id: w.question_bank_id || null,
        wrong_count: wrongCountMap[w.question_text?.slice(0, 50) ?? ''] ?? 1,
        last_wrong: w.created_at,
        student_answer: w.student_answer,
      };
    });

    // 과목별 요약
    const subjectMap: Record<string, number> = {};
    problems.forEach(p => {
      const s = (p.subject as string) || '미분류';
      subjectMap[s] = (subjectMap[s] || 0) + 1;
    });

    return NextResponse.json({
      problems,
      total: problems.length,
      subjects: subjectMap,
    });
  } catch (error) {
    console.error('wrong-answers API 오류:', error);
    return NextResponse.json({ error: '오답노트 API 오류' }, { status: 500 });
  }
}
