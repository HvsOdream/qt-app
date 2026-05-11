// GET /api/admin — BloomLens 관리자 대시보드
// 새 모델(wrong_note 단일 테이블 + parent_id) 기반 통계
import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'qt-admin-2024';
const DAY_MS = 24 * 60 * 60 * 1000;

interface NoteRow {
  device_id: string;
  source: 'scan' | 'generated';
  parent_id: string | null;
  subject: string | null;
  topic: string | null;
  mastered: boolean;
  times_correct: number;
  times_wrong: number;
  created_at: string;
  last_attempted_at: string | null;
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('x-admin-secret');
  if (auth !== ADMIN_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getServiceClient();

  // 1) 유저 목록 (Supabase Auth)
  const { data: usersResp, error: usersError } = await supabase.auth.admin.listUsers();
  if (usersError) {
    return NextResponse.json({ error: usersError.message }, { status: 500 });
  }
  const users = usersResp.users || [];

  // 2) wrong_note 전체 fetch (필요한 컬럼만)
  const { data: notesRaw, error: notesError } = await supabase
    .from('wrong_note')
    .select('device_id, source, parent_id, subject, topic, mastered, times_correct, times_wrong, created_at, last_attempted_at');
  if (notesError) {
    return NextResponse.json({ error: notesError.message }, { status: 500 });
  }
  const notes: NoteRow[] = (notesRaw || []) as NoteRow[];

  // 3) device_id 기준 그룹화
  const now = Date.now();
  const byUser = new Map<string, NoteRow[]>();
  notes.forEach((n) => {
    if (!n.device_id) return;
    if (!byUser.has(n.device_id)) byUser.set(n.device_id, []);
    byUser.get(n.device_id)!.push(n);
  });

  // 4) 각 유저별 통계 산출
  const result = users.map((u) => {
    const myNotes = byUser.get(u.id) || [];
    const originals = myNotes.filter((n) => n.source === 'scan');
    const children  = myNotes.filter((n) => n.source === 'generated');
    const mastered  = myNotes.filter((n) => n.mastered);
    const attempts  = myNotes.reduce((s, n) => s + n.times_correct + n.times_wrong, 0);
    const correct   = myNotes.reduce((s, n) => s + n.times_correct, 0);

    // 카테고리 (subject+topic) 종류 수
    const catKeys = new Set<string>();
    originals.forEach((n) => {
      const s = (n.subject || '').trim();
      const t = (n.topic || '').trim();
      catKeys.add(`${s}§${t}`);
    });

    // 최근 24h 활동 (last_attempted_at 또는 created_at 기준)
    const lastActive = myNotes.reduce<number>((max, n) => {
      const t1 = n.last_attempted_at ? new Date(n.last_attempted_at).getTime() : 0;
      const t2 = n.created_at ? new Date(n.created_at).getTime() : 0;
      return Math.max(max, t1, t2);
    }, 0);
    const activeRecently = lastActive > 0 && (now - lastActive) < DAY_MS;

    return {
      id: u.id,
      email: u.email || '(이메일 없음)',
      provider: u.app_metadata?.provider || 'unknown',
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      original_count: originals.length,
      child_count:    children.length,
      mastered_count: mastered.length,
      category_count: catKeys.size,
      attempt_count:  attempts,
      correct_count:  correct,
      accuracy:       attempts > 0 ? Math.round((correct / attempts) * 100) : 0,
      last_active_at: lastActive ? new Date(lastActive).toISOString() : null,
      active_recently: activeRecently,
    };
  });

  // 5) 전체 합계
  const totals = {
    users:     users.length,
    originals: notes.filter((n) => n.source === 'scan').length,
    children:  notes.filter((n) => n.source === 'generated').length,
    mastered:  notes.filter((n) => n.mastered).length,
    attempts:  notes.reduce((s, n) => s + n.times_correct + n.times_wrong, 0),
    active_24h: result.filter((u) => u.active_recently).length,
  };

  return NextResponse.json({ users: result, totals });
}
