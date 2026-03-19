import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

// 과목/주제 요약 서버사이드 캐시 (5분 TTL, per-device)
const summaryCacheMap = new Map<string, { data: Record<string, Record<string, number>>; ts: number }>();
const SUMMARY_TTL_MS = 5 * 60 * 1000; // 5분

async function getCategoryMap(deviceId: string | null): Promise<Record<string, Record<string, number>>> {
  const cacheKey = deviceId || '__all__';
  const now = Date.now();
  const cached = summaryCacheMap.get(cacheKey);
  if (cached && now - cached.ts < SUMMARY_TTL_MS) {
    return cached.data;
  }

  const supabase = getServiceClient();

  // device_id 컬럼이 있으면 필터, 없으면 전체 조회 (컬럼 미생성 시 graceful fallback)
  let summary: { subject: string; topic: string }[] | null = null;
  try {
    let q = supabase.from('question_bank').select('subject, topic');
    if (deviceId) q = q.eq('device_id', deviceId);
    const { data, error } = await q;
    if (error) {
      // device_id 컬럼이 없어서 생긴 에러면 필터 없이 재시도
      if (error.message?.includes('device_id') || error.code === '42703') {
        const { data: fallbackData } = await supabase.from('question_bank').select('subject, topic');
        summary = fallbackData;
      } else {
        console.error('getCategoryMap 오류:', error);
      }
    } else {
      summary = data;
    }
  } catch (e) {
    console.error('getCategoryMap 예외:', e);
  }

  const categoryMap: Record<string, Record<string, number>> = {};
  if (summary) {
    for (const row of summary) {
      const s = row.subject || '미분류';
      const t = row.topic || '미분류';
      if (!categoryMap[s]) categoryMap[s] = {};
      categoryMap[s][t] = (categoryMap[s][t] || 0) + 1;
    }
  }

  summaryCacheMap.set(cacheKey, { data: categoryMap, ts: now });
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

    // device_id 필터 (컬럼 없으면 에러 → fallback)
    let data = null;
    let error = null;
    let count = 0;

    try {
      let q = query;
      if (deviceId) q = q.eq('device_id', deviceId);
      if (subject) q = q.eq('subject', subject);
      if (topic) q = q.eq('topic', topic);
      if (difficulty) q = q.eq('difficulty', parseInt(difficulty));
      if (keyword) q = q.contains('keywords', [keyword]);
      q = q.range(offset, offset + limit - 1);

      const result = await q;
      data = result.data;
      error = result.error;
      count = result.count || 0;

      // device_id 컬럼 없으면 필터 없이 재시도
      if (error && (error.message?.includes('device_id') || error.code === '42703')) {
        let fallbackQ = supabase
          .from('question_bank')
          .select('*', { count: 'exact' })
          .order('created_at', { ascending: false });
        if (subject) fallbackQ = fallbackQ.eq('subject', subject);
        if (topic) fallbackQ = fallbackQ.eq('topic', topic);
        if (difficulty) fallbackQ = fallbackQ.eq('difficulty', parseInt(difficulty));
        if (keyword) fallbackQ = fallbackQ.contains('keywords', [keyword]);
        fallbackQ = fallbackQ.range(offset, offset + limit - 1);
        const fallback = await fallbackQ;
        data = fallback.data;
        error = fallback.error;
        count = fallback.count || 0;
      }
    } catch (queryErr) {
      console.error('question_bank 쿼리 예외:', queryErr);
    }

    if (error) {
      console.error('question_bank 조회 오류:', error);
      return NextResponse.json({ error: '문제은행 조회 실패' }, { status: 500 });
    }

    // 카테고리 요약 (device 격리)
    const [categoryMap] = await Promise.all([
      skipSummary ? Promise.resolve(null) : getCategoryMap(deviceId),
    ]);

    return NextResponse.json({
      problems: data || [],
      total: count,
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
