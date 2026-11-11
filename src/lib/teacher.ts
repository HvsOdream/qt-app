// 교수자용 관리 화면 공통: 로그인 확인, 교수자 확인, 트랙 통계 계산
import { NextRequest } from 'next/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { getServiceClient } from '@/lib/supabase';

export interface AuthResult {
  user: User | null;
  supabase: SupabaseClient;
}

// Authorization: Bearer <access_token> 으로 로그인 사용자를 확인한다.
export async function getAuthUser(req: NextRequest): Promise<AuthResult> {
  const supabase = getServiceClient();
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return { user: null, supabase };
  const { data, error } = await supabase.auth.getUser(token);
  return { user: error ? null : data.user, supabase };
}

// 교수자 계정: 환경변수 TEACHER_EMAILS (쉼표 구분)에 있는 이메일만 허용한다.
export function isTeacher(user: User | null): boolean {
  if (!user?.email) return false;
  const allow = (process.env.TEACHER_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return allow.includes(user.email.toLowerCase());
}

export interface NoteRow {
  id: string;
  device_id: string;
  subject: string | null;
  topic: string | null;
  question_text: string;
  source: 'scan' | 'generated';
  parent_id: string | null;
  times_wrong: number;
  times_correct: number;
  mastered: boolean;
  last_attempted_at: string | null;
  created_at: string;
}

export const NOTE_COLUMNS =
  'id, device_id, subject, topic, question_text, source, parent_id, times_wrong, times_correct, mastered, last_attempted_at, created_at';

const norm = (s: string | null | undefined) => (s || '').trim();

export interface OriginalStat {
  note: NoteRow;
  childCount: number;
  childMastered: number;
  done: boolean;
}

// 학생 한 명의 노트에서, 트랙(과목 = 트랙 이름)에 속한 원본 문제와 진행 상태를 뽑는다.
// 완료 기준은 학생 앱과 같다: 원본이 mastered 이거나, 유사문제가 있고 전부 mastered.
export function originalsOfTrack(notes: NoteRow[], trackName: string): OriginalStat[] {
  const children = new Map<string, NoteRow[]>();
  notes.forEach((n) => {
    if (n.source === 'generated' && n.parent_id) {
      if (!children.has(n.parent_id)) children.set(n.parent_id, []);
      children.get(n.parent_id)!.push(n);
    }
  });
  return notes
    .filter((n) => n.source === 'scan' && norm(n.subject) === norm(trackName))
    .map((note) => {
      const kids = children.get(note.id) || [];
      const childMastered = kids.filter((k) => k.mastered).length;
      const done = note.mastered || (kids.length > 0 && childMastered === kids.length);
      return { note, childCount: kids.length, childMastered, done };
    });
}

// 유사문제 풀이 횟수·정답 수 (트랙에 속한 원본의 유사문제만)
export function childAttempts(notes: NoteRow[], originals: OriginalStat[]) {
  const ids = new Set(originals.map((o) => o.note.id));
  let attempts = 0;
  let correct = 0;
  notes.forEach((n) => {
    if (n.source === 'generated' && n.parent_id && ids.has(n.parent_id)) {
      attempts += n.times_correct + n.times_wrong;
      correct += n.times_correct;
    }
  });
  return { attempts, correct };
}

export function lastActive(notes: NoteRow[]): string | null {
  let max = 0;
  notes.forEach((n) => {
    const t1 = n.last_attempted_at ? new Date(n.last_attempted_at).getTime() : 0;
    const t2 = n.created_at ? new Date(n.created_at).getTime() : 0;
    max = Math.max(max, t1, t2);
  });
  return max ? new Date(max).toISOString() : null;
}

export function rate(done: number, total: number): number | null {
  return total > 0 ? Math.round((done / total) * 100) : null;
}

export function unitRates(originals: OriginalStat[], unitTitles: string[]) {
  return unitTitles.map((title) => {
    const mine = originals.filter((o) => norm(o.note.topic) === norm(title));
    const done = mine.filter((o) => o.done).length;
    return { title, total: mine.length, done, rate: rate(done, mine.length) };
  });
}

// 헷갈리는 글자(0/O, 1/I/L)를 뺀 참여 코드
export function makeJoinCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
