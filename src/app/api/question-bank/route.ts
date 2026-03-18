import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const subject = searchParams.get('subject');
    const topic = searchParams.get('topic');
    const difficulty = searchParams.get('difficulty');
    const keyword = searchParams.get('keyword');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    const supabase = getServiceClient();

    let query = supabase
      .from('question_bank')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (subject) query = query.eq('subject', subject);
    if (topic) query = query.eq('topic', topic);
    if (difficulty) query = query.eq('difficulty', parseInt(difficulty));
    if (keyword) query = query.contains('keywords', [keyword]);

    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      console.error('question_bank 조회 오류:', error);
      return NextResponse.json({ error: '문제은행 조회 실패' }, { status: 500 });
    }

    // 과목/주제별 카운트 (요약용)
    const { data: summary } = await supabase
      .from('question_bank')
      .select('subject, topic');

    const categoryMap: Record<string, Record<string, number>> = {};
    if (summary) {
      for (const row of summary) {
        const s = row.subject || '미분류';
        const t = row.topic || '미분류';
        if (!categoryMap[s]) categoryMap[s] = {};
        categoryMap[s][t] = (categoryMap[s][t] || 0) + 1;
      }
    }

    return NextResponse.json({
      problems: data || [],
      total: count || 0,
      categories: categoryMap,
    });
  } catch (error) {
    console.error('question_bank API 오류:', error);
    return NextResponse.json(
      { error: '문제은행 API 오류' },
      { status: 500 }
    );
  }
}
