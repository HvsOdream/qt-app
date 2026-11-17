// GET /api/lab/export?kind=events|sessions — 로그 내보내기(CSV). 교수자 계정만.
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, isTeacher } from '@/lib/teacher';

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(req: NextRequest) {
  const { user, supabase } = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 });
  if (!isTeacher(user)) return NextResponse.json({ error: '권한이 없습니다' }, { status: 403 });

  const k = new URL(req.url).searchParams.get('kind');
  const kind = k === 'sessions' || k === 'participants' ? k : 'events';
  const table = kind === 'sessions' ? 'lab_sessions' : kind === 'participants' ? 'lab_participants' : 'lab_events';
  const cols = kind === 'participants'
    ? ['user_id', 'research_code', 'condition', 'block_id', 'survey_done_at', 'created_at']
    : kind === 'sessions'
    ? ['id', 'user_id', 'condition', 'track', 'block_id', 'plan_minutes', 'plan_at', 'checkout_at', 'checkout_source', 'reason', 'fatigue', 'survey_out']
    : ['id', 'user_id', 'session_id', 'condition', 'track', 't_server', 't_ms_client', 'type', 'item_id', 'payload'];

  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from(table).select(cols.join(','))
      .order(kind === 'sessions' ? 'plan_at' : kind === 'participants' ? 'created_at' : 'id').range(from, from + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    rows.push(...((data || []) as unknown as Record<string, unknown>[]));
    if (!data || data.length < 1000) break;
  }

  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n');
  return new NextResponse('﻿' + csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="lab_${kind}.csv"`,
    },
  });
}
