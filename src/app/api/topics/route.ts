import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

// 사용자의 오답 데이터에서 과목 → 주제 트리를 동적으로 생성
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');

    const supabase = getServiceClient();

    let query = supabase
      .from('wrong_answers')
      .select('subject, topic, keywords, created_at')
      .order('created_at', { ascending: false });

    // user_id가 있으면 해당 유저의 데이터만 필터
    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data: wrongAnswers, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!wrongAnswers || wrongAnswers.length === 0) {
      return NextResponse.json({ topics: [], totalWrong: 0 });
    }

    // subject → topic으로 그룹핑 + 카운트
    const map = new Map<string, Map<string, { count: number; keywords: Set<string>; lastSeen: string }>>();

    for (const row of wrongAnswers) {
      const subj = row.subject || '미분류';
      const topic = row.topic || '기타';

      if (!map.has(subj)) map.set(subj, new Map());
      const topicMap = map.get(subj)!;

      if (!topicMap.has(topic)) {
        topicMap.set(topic, { count: 0, keywords: new Set(), lastSeen: row.created_at });
      }
      const entry = topicMap.get(topic)!;
      entry.count++;
      if (row.keywords) {
        for (const kw of row.keywords) entry.keywords.add(kw);
      }
    }

    // 트리 구조로 변환
    const topics = Array.from(map.entries()).map(([subject, topicMap]) => ({
      subject,
      totalWrong: Array.from(topicMap.values()).reduce((s, t) => s + t.count, 0),
      topics: Array.from(topicMap.entries())
        .map(([topic, data]) => ({
          topic,
          wrongCount: data.count,
          keywords: Array.from(data.keywords),
          lastSeen: data.lastSeen,
        }))
        .sort((a, b) => b.wrongCount - a.wrongCount),
    })).sort((a, b) => b.totalWrong - a.totalWrong);

    return NextResponse.json({
      topics,
      totalWrong: wrongAnswers.length,
    });
  } catch (error) {
    console.error('토픽 조회 오류:', error);
    return NextResponse.json(
      { error: '토픽 목록을 가져오는 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
