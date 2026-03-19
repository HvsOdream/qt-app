import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

// 과목/주제 요약 서버사이드 캐시 (5분 TTL)
let summaryCache: Record<string, Record<string, number>> | null = null;
let summaryCachedAt = 0;
const SUMMARY_TTL_MS = 5 * 60 * 1000; // 5분

async function getCategoryMap(): Promise<Record<string, Record<string, number>>> {
  const now = Date.now();
  if (summaryCache && now - summaryCachedAt < SUMMARY_TTL_MS) {
    return summaryCache;
  }
  const supabase = getServiceClient();
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
  summaryCache = categoryMap;
  summaryCachedAt = now;
  return categoryMap;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const subject = searchParams.get('subject');
    const topic = searchParams.get('topic');
    const difficulty = searchParams.get('difficulty');
    const keyword = searchParams.get('keyword');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    const skipSummary = searchParams.get('skipSummary') === 'true';
    const deviceId = request.headers.get('x-device-id');

    const supabase = getServiceClient();

    let query = supabase
      .from('question_bank')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });

    // device_id가 있으면 해당 사용자 데이터만 조회
    if (deviceId) query = query.eq('device_id', deviceId);
    if (subject) query = query.eq('subject', subject);
    if (topic) query = query.eq('topic', topic);
    if (difficulty) query = query.eq('difficulty', parseInt(difficulty));
    if (keyword) query = query.contains('keywords', [keyword]);

    query = query.range(offset, offset + limit - 1);

    // 문제 목록 + 카테고리 요약 병렬 요청
    const [{ data, error, count }, categoryMap] = await Promise.all([
      query,
      skipSummary ? Promise.resolve(null) : getCategoryMap(),
    ]);

    if (error) {
      console.error('question_bank 조회 오류:', error);
      return NextResponse.json({ error: '문제은행 조회 실패' }, { status: 500 });
    }

    return NextResponse.json({
      problems: data || [],
      total: count || 0,
      categories: categoryMap ?? undefined,
    });
  } catch (error) {
    console.error('question_bank API 오류:', error);
    return NextResponse.json(
      { error: '문제은행 API 오류' },
      { status: 500 }
    );
  }
}
