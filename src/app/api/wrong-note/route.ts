// GET  /api/wrong-note  — 목록 조회
// POST /api/wrong-note  — 항목 추가 (스캔 저장)
import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const deviceId = searchParams.get('device_id');
  const subject   = searchParams.get('subject');
  const topic     = searchParams.get('topic');
  const mastered  = searchParams.get('mastered'); // 'true' | 'false' | null(전체)

  if (!deviceId) {
    return NextResponse.json({ error: 'device_id 필요' }, { status: 400 });
  }

  const supabase = getServiceClient();
  let query = supabase
    .from('wrong_note')
    .select('*')
    .eq('device_id', deviceId)
    .order('created_at', { ascending: false });

  if (subject)  query = query.eq('subject', subject);
  if (topic)    query = query.eq('topic', topic);
  if (mastered !== null) query = query.eq('mastered', mastered === 'true');

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 과목별 요약 (필터 칩 생성용)
  const subjects: Record<string, number> = {};
  (data || []).forEach((item) => {
    const s = item.subject || '미분류';
    subjects[s] = (subjects[s] || 0) + 1;
  });

  return NextResponse.json({ items: data || [], subjects });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  // body.items: WrongNoteInsert[] — 스캔 후 카테고리 확인된 문제들
  const { device_id, items } = body as {
    device_id: string;
    items: {
      subject?: string;
      topic?: string;
      question_text: string;
      choices?: string[];
      question_type?: string;
      correct_answer: string;
      explanation?: string;
      source?: string;
      parent_id?: string;
    }[];
  };

  if (!device_id || !items?.length) {
    return NextResponse.json({ error: 'device_id, items 필요' }, { status: 400 });
  }

  const supabase = getServiceClient();
  const rows = items.map((item) => ({
    device_id,
    subject:        item.subject || null,
    topic:          item.topic || null,
    question_text:  item.question_text,
    choices:        item.choices || [],
    question_type:  item.question_type || 'multiple_choice',
    correct_answer: item.correct_answer,
    explanation:    item.explanation || null,
    source:         item.source || 'scan',
    parent_id:      item.parent_id || null,
    times_wrong:    0,
    times_correct:  0,
    mastered:       false,
  }));

  const { data, error } = await supabase
    .from('wrong_note')
    .insert(rows)
    .select();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ saved: data });
}
