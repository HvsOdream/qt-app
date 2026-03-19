import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'qt-admin-2024';

export async function GET(req: NextRequest) {
  const auth = req.headers.get('x-admin-secret');
  if (auth !== ADMIN_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getServiceClient();

  // 1. 유저 목록 (auth.users)
  const { data: users, error: usersError } = await supabase.auth.admin.listUsers();
  if (usersError) {
    return NextResponse.json({ error: usersError.message }, { status: 500 });
  }

  // 2. 유저별 문제은행 개수
  const { data: bankCounts, error: bankError } = await supabase
    .from('question_bank')
    .select('device_id')
    .neq('device_id', 'unknown');

  if (bankError) {
    return NextResponse.json({ error: bankError.message }, { status: 500 });
  }

  // 3. 유저별 퀴즈 결과 개수
  const { data: quizCounts, error: quizError } = await supabase
    .from('quiz_results')
    .select('device_id')
    .neq('device_id', 'unknown');

  if (quizError) {
    return NextResponse.json({ error: quizError.message }, { status: 500 });
  }

  // 집계
  const bankMap: Record<string, number> = {};
  for (const row of bankCounts || []) {
    bankMap[row.device_id] = (bankMap[row.device_id] || 0) + 1;
  }

  const quizMap: Record<string, number> = {};
  for (const row of quizCounts || []) {
    quizMap[row.device_id] = (quizMap[row.device_id] || 0) + 1;
  }

  const result = (users.users || []).map((u) => ({
    id: u.id,
    email: u.email || '(이메일 없음)',
    provider: u.app_metadata?.provider || 'unknown',
    created_at: u.created_at,
    last_sign_in_at: u.last_sign_in_at,
    question_count: bankMap[u.id] || 0,
    quiz_count: quizMap[u.id] || 0,
  }));

  return NextResponse.json({ users: result });
}
