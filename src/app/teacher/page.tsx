'use client';

// 교수자용 관리 화면 — 학습 현황 / 학습 트랙 / 학생별 학습 (PC 웹)
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import type { Session } from '@supabase/supabase-js';

type Tab = 'overview' | 'tracks' | 'student';
type Kind = 'class' | 'cert' | 'personal';

interface Track {
  id: string;
  name: string;
  kind: Kind;
  join_code: string;
  unit_count: number;
  member_count: number;
}
interface UnitRate { title: string; total: number; done: number; rate: number | null }
interface StudentRow {
  id: string;
  email: string;
  original_count: number;
  done_count: number;
  rate: number | null;
  last_active_at: string | null;
}
interface Overview {
  totals: { members: number; originals: number; attempts: number; rate: number | null };
  units: UnitRate[];
  students: StudentRow[];
}
interface StudentDetail {
  student: { id: string; email: string };
  totals: { originals: number; done: number; accuracy: number | null; last_active_at: string | null };
  units: UnitRate[];
  problems: {
    id: string;
    question_text: string;
    topic: string | null;
    child_count: number;
    child_mastered: number;
    status: 'done' | 'learning' | 'none';
  }[];
}

const KIND_LABEL: Record<Kind, string> = { class: '수업', cert: '자격증', personal: '개인' };

function fmtAgo(d: string | null) {
  if (!d) return '-';
  const min = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
}

function RateBar({ rate }: { rate: number | null }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded bg-slate-200 overflow-hidden">
        <div className="h-full rounded bg-[#1B3F8B]" style={{ width: `${rate ?? 0}%` }} />
      </div>
      <span className="w-10 text-right text-sm font-bold">{rate === null ? '-' : `${rate}%`}</span>
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string | number; unit?: string }) {
  return (
    <div className="bg-white rounded-2xl px-5 py-4 shadow-sm">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-2xl font-extrabold mt-1">
        {value}
        {unit && <span className="text-sm font-medium text-slate-500"> {unit}</span>}
      </p>
    </div>
  );
}

export default function TeacherPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [denied, setDenied] = useState('');
  const [tab, setTab] = useState<Tab>('overview');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [trackId, setTrackId] = useState('');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [studentId, setStudentId] = useState('');
  const [detail, setDetail] = useState<StudentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 새 트랙 입력
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<Kind>('class');
  const [newUnits, setNewUnits] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!supabase) { setReady(true); return; }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const res = await fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token || ''}`,
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || '오류가 발생했습니다'), { status: res.status });
    return data;
  }, [session]);

  const loadTracks = useCallback(async () => {
    try {
      const data = await api('/api/teacher/tracks');
      setTracks(data.tracks || []);
      setTrackId((cur) => cur || data.tracks?.[0]?.id || '');
      setDenied('');
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 403) setDenied(err.message);
      else setError(err.message);
    }
  }, [api]);

  useEffect(() => { if (session) loadTracks(); }, [session, loadTracks]);

  useEffect(() => {
    if (!session || !trackId) { setOverview(null); return; }
    setLoading(true);
    setError('');
    api(`/api/teacher/overview?track_id=${trackId}`)
      .then((data) => setOverview(data))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [session, trackId, api]);

  useEffect(() => {
    if (!session || !trackId || !studentId) { setDetail(null); return; }
    api(`/api/teacher/student?track_id=${trackId}&user_id=${studentId}`)
      .then((data) => setDetail(data))
      .catch((e: Error) => setError(e.message));
  }, [session, trackId, studentId, api]);

  async function createTrack() {
    if (!newName.trim()) { setError('트랙 이름을 입력해 주세요'); return; }
    setCreating(true);
    setError('');
    try {
      const units = newUnits.split('\n').map((u) => u.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean);
      const data = await api('/api/teacher/tracks', {
        method: 'POST',
        body: JSON.stringify({ name: newName, kind: newKind, units }),
      });
      setNewName(''); setNewUnits('');
      await loadTracks();
      setTrackId(data.track.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  function downloadCsv() {
    if (!overview) return;
    const rows = [['학생', '등록 문제', '정복', '정복률(%)', '최근 활동']].concat(
      overview.students.map((s) => [
        s.email, String(s.original_count), String(s.done_count),
        s.rate === null ? '' : String(s.rate), s.last_active_at || '',
      ]),
    );
    const csv = '﻿' + rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `${track?.name || 'track'}_학습현황.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const track = tracks.find((t) => t.id === trackId);

  // ── 로그인·권한 안내 ──
  if (!ready) return <div className="min-h-screen bg-slate-100" />;
  if (!session || denied) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl p-8 w-96 shadow-sm text-center space-y-3">
          <p className="text-[#1B3F8B] font-black text-xl">Bloom<span className="text-amber-500">Lens</span></p>
          <p className="font-bold">교수자용 관리 화면</p>
          <p className="text-sm text-slate-500">
            {denied
              ? `${session?.user.email} 계정은 교수자로 등록되어 있지 않습니다.`
              : '교수자 계정으로 로그인한 뒤 이용할 수 있습니다.'}
          </p>
          <Link href="/" className="inline-block bg-[#1B3F8B] text-white text-sm font-bold rounded-xl px-5 py-2.5">
            {denied ? '학습 화면으로' : '로그인하러 가기'}
          </Link>
        </div>
      </div>
    );
  }

  const nav: { key: Tab; label: string }[] = [
    { key: 'overview', label: '학습 현황' },
    { key: 'tracks', label: '학습 트랙' },
    { key: 'student', label: '학생별 학습' },
  ];

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex">
      {/* 사이드바 */}
      <aside className="w-56 shrink-0 bg-[#1B3F8B] text-white px-3.5 py-6 flex flex-col gap-1.5">
        <p className="px-2 text-lg font-extrabold">BloomLens</p>
        <p className="px-2 pb-4 text-xs opacity-75">교수자용 관리 화면</p>
        {nav.map((n) => (
          <button
            key={n.key}
            onClick={() => setTab(n.key)}
            className={`h-10 px-3 rounded-lg text-left text-sm transition ${
              tab === n.key ? 'bg-white/15 font-bold' : 'opacity-80 hover:opacity-100'
            }`}
          >
            {n.label}
          </button>
        ))}
        <div className="mt-auto px-2 text-xs opacity-80 leading-relaxed break-all">
          {session.user.email}
          <br />
          <Link href="/" className="underline">학습 화면으로</Link>
        </div>
      </aside>

      <main className="flex-1 min-w-0 p-8 space-y-4">
        {/* 상단: 제목 + 트랙 선택 */}
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-extrabold">{nav.find((n) => n.key === tab)?.label}</h1>
            <p className="text-sm text-slate-500 mt-1">
              {tab === 'tracks'
                ? '수업·자격증 단위로 트랙을 만들고 참여 코드로 학생을 연결합니다'
                : track
                  ? `${track.name} · 참여 학생 ${track.member_count}명`
                  : '학습 트랙을 먼저 만들어 주세요'}
            </p>
          </div>
          {tab !== 'tracks' && tracks.length > 0 && (
            <div className="flex gap-2">
              <select
                value={trackId}
                onChange={(e) => { setTrackId(e.target.value); setStudentId(''); }}
                className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm font-bold text-[#1B3F8B]"
              >
                {tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              {tab === 'overview' && (
                <button
                  onClick={downloadCsv}
                  className="h-10 px-4 rounded-lg border border-slate-300 bg-white text-sm font-bold text-[#1B3F8B]"
                >
                  CSV 내려받기
                </button>
              )}
              {tab === 'student' && overview && (
                <select
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                  className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm font-bold text-[#1B3F8B] max-w-60"
                >
                  <option value="">학생 선택</option>
                  {overview.students.map((s) => <option key={s.id} value={s.id}>{s.email}</option>)}
                </select>
              )}
            </div>
          )}
        </div>

        {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>}

        {/* ── 학습 현황 ── */}
        {tab === 'overview' && (
          !track ? (
            <Empty text="학습 트랙 메뉴에서 트랙을 만들면 학습 현황이 여기에 표시됩니다." />
          ) : loading || !overview ? (
            <Empty text="불러오는 중..." />
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                <Stat label="참여 학생" value={overview.totals.members} unit="명" />
                <Stat label="등록한 오답 문제" value={overview.totals.originals} unit="문제" />
                <Stat label="유사문제 풀이" value={overview.totals.attempts.toLocaleString()} unit="회" />
                <Stat label="평균 정복률" value={overview.totals.rate ?? '-'} unit={overview.totals.rate === null ? undefined : '%'} />
              </div>
              <div className="grid lg:grid-cols-[1fr_1.25fr] gap-3.5">
                <section className="bg-white rounded-2xl p-5 shadow-sm">
                  <h2 className="text-sm font-extrabold mb-3">단원별 정복률</h2>
                  {overview.units.length === 0 ? (
                    <p className="text-sm text-slate-400">등록된 단원이 없습니다.</p>
                  ) : (
                    <div className="space-y-3">
                      {overview.units.map((u) => (
                        <div key={u.title}>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="font-medium">{u.title}</span>
                            <span className="text-xs text-slate-400">{u.done}/{u.total}문제</span>
                          </div>
                          <RateBar rate={u.rate} />
                        </div>
                      ))}
                    </div>
                  )}
                </section>
                <section className="bg-white rounded-2xl p-5 shadow-sm overflow-x-auto">
                  <h2 className="text-sm font-extrabold mb-3">학생별 현황</h2>
                  {overview.students.length === 0 ? (
                    <p className="text-sm text-slate-400">
                      아직 참여한 학생이 없습니다. 참여 코드 <b className="font-mono">{track.join_code}</b>를 학생에게 알려 주세요.
                    </p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-slate-500 text-left border-b border-slate-200">
                          <th className="py-2 font-medium">학생</th>
                          <th className="py-2 font-medium">등록 문제</th>
                          <th className="py-2 font-medium">정복</th>
                          <th className="py-2 font-medium w-44">정복률</th>
                          <th className="py-2 font-medium">최근 활동</th>
                        </tr>
                      </thead>
                      <tbody>
                        {overview.students.map((s) => (
                          <tr
                            key={s.id}
                            onClick={() => { setStudentId(s.id); setTab('student'); }}
                            className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                          >
                            <td className="py-2.5 font-bold max-w-52 truncate">{s.email}</td>
                            <td>{s.original_count}</td>
                            <td>{s.done_count}</td>
                            <td><RateBar rate={s.rate} /></td>
                            <td className="pl-3 text-xs text-slate-500">{fmtAgo(s.last_active_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </section>
              </div>
            </>
          )
        )}

        {/* ── 학습 트랙 ── */}
        {tab === 'tracks' && (
          <div className="grid lg:grid-cols-[1.2fr_1fr] gap-3.5">
            <section className="bg-white rounded-2xl p-5 shadow-sm overflow-x-auto">
              <h2 className="text-sm font-extrabold mb-3">내 학습 트랙</h2>
              {tracks.length === 0 ? (
                <p className="text-sm text-slate-400">아직 만든 트랙이 없습니다.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500 text-left border-b border-slate-200">
                      <th className="py-2 font-medium">트랙</th>
                      <th className="py-2 font-medium">구분</th>
                      <th className="py-2 font-medium">단원</th>
                      <th className="py-2 font-medium">참여 학생</th>
                      <th className="py-2 font-medium">참여 코드</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tracks.map((t) => (
                      <tr key={t.id} className="border-b border-slate-100">
                        <td className="py-2.5 font-bold">{t.name}</td>
                        <td><span className="text-xs font-bold rounded-lg px-2 py-0.5 bg-[#1B3F8B]/10 text-[#1B3F8B]">{KIND_LABEL[t.kind]}</span></td>
                        <td>{t.unit_count}</td>
                        <td>{t.member_count}명</td>
                        <td className="font-mono">{t.join_code}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="mt-4 border border-dashed border-slate-300 rounded-xl px-4 py-3 text-xs text-slate-500 leading-relaxed">
                학생은 앱 홈 화면의 「수업 참여」에 참여 코드를 입력하면 트랙에 연결됩니다.
                단원 입력 화면에서 트랙과 단원을 골라 저장한 오답 문제가 이 화면에 집계됩니다.
              </p>
            </section>
            <section className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
              <h2 className="text-sm font-extrabold">새 학습 트랙 만들기</h2>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5">트랙 이름</label>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="예: 게임기획의이해 A반"
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 text-sm outline-none focus:border-[#1B3F8B]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5">구분</label>
                <div className="flex gap-1.5">
                  {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                    <button
                      key={k}
                      onClick={() => setNewKind(k)}
                      className={`h-9 px-4 rounded-lg text-sm font-bold border ${
                        newKind === k ? 'bg-[#1B3F8B] text-white border-[#1B3F8B]' : 'bg-white text-[#1B3F8B] border-slate-300'
                      }`}
                    >
                      {KIND_LABEL[k]}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5">단원 (한 줄에 하나)</label>
                <textarea
                  value={newUnits}
                  onChange={(e) => setNewUnits(e.target.value)}
                  rows={6}
                  placeholder={'게임의 정의와 구성 요소\n재미 이론\nMDA 프레임워크'}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm leading-relaxed outline-none focus:border-[#1B3F8B] resize-none"
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-slate-500">저장하면 참여 코드가 자동으로 만들어집니다</span>
                <button
                  onClick={createTrack}
                  disabled={creating}
                  className="h-10 px-5 rounded-lg bg-[#1B3F8B] text-white text-sm font-bold disabled:opacity-50"
                >
                  {creating ? '만드는 중...' : '트랙 만들기'}
                </button>
              </div>
            </section>
          </div>
        )}

        {/* ── 학생별 학습 ── */}
        {tab === 'student' && (
          !track ? (
            <Empty text="학습 트랙을 먼저 만들어 주세요." />
          ) : !studentId ? (
            <Empty text="위에서 학생을 선택하거나, 학습 현황의 학생 목록에서 학생을 눌러 주세요." />
          ) : !detail ? (
            <Empty text="불러오는 중..." />
          ) : (
            <>
              <p className="text-sm font-bold">{detail.student.email}</p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                <Stat label="등록한 오답 문제" value={detail.totals.originals} unit="문제" />
                <Stat label="정복한 문제" value={detail.totals.done} unit="문제" />
                <Stat label="유사문제 정답률" value={detail.totals.accuracy ?? '-'} unit={detail.totals.accuracy === null ? undefined : '%'} />
                <Stat label="최근 활동" value={fmtAgo(detail.totals.last_active_at)} />
              </div>
              <div className="grid lg:grid-cols-[1fr_1.25fr] gap-3.5">
                <section className="bg-white rounded-2xl p-5 shadow-sm">
                  <h2 className="text-sm font-extrabold mb-3">단원별 정복률</h2>
                  {detail.units.length === 0 ? (
                    <p className="text-sm text-slate-400">등록된 단원이 없습니다.</p>
                  ) : (
                    <div className="space-y-3">
                      {detail.units.map((u) => (
                        <div key={u.title}>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="font-medium">{u.title}</span>
                            <span className="text-xs text-slate-400">{u.done}/{u.total}문제</span>
                          </div>
                          <RateBar rate={u.rate} />
                        </div>
                      ))}
                    </div>
                  )}
                </section>
                <section className="bg-white rounded-2xl p-5 shadow-sm overflow-x-auto">
                  <h2 className="text-sm font-extrabold mb-3">최근 틀린 문제</h2>
                  {detail.problems.length === 0 ? (
                    <p className="text-sm text-slate-400">이 트랙으로 등록한 문제가 없습니다.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-slate-500 text-left border-b border-slate-200">
                          <th className="py-2 font-medium">문제</th>
                          <th className="py-2 font-medium">단원</th>
                          <th className="py-2 font-medium">유사문제</th>
                          <th className="py-2 font-medium">상태</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.problems.map((p) => (
                          <tr key={p.id} className="border-b border-slate-100">
                            <td className="py-2.5 font-medium max-w-80 truncate">{p.question_text}</td>
                            <td className="text-slate-500 whitespace-nowrap pr-3">{p.topic || '-'}</td>
                            <td className="whitespace-nowrap pr-3">
                              {p.child_count ? `${p.child_count}개 · ${p.child_mastered}/${p.child_count}` : '없음'}
                            </td>
                            <td>
                              <span className={`text-xs font-bold rounded-lg px-2 py-0.5 whitespace-nowrap ${
                                p.status === 'done' ? 'bg-emerald-50 text-emerald-700'
                                  : p.status === 'none' ? 'bg-amber-50 text-amber-700'
                                  : 'bg-[#1B3F8B]/10 text-[#1B3F8B]'
                              }`}>
                                {p.status === 'done' ? '정복' : p.status === 'none' ? '미시작' : '학습 중'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </section>
              </div>
            </>
          )
        )}
      </main>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="bg-white rounded-2xl p-10 shadow-sm text-center text-sm text-slate-400">{text}</div>;
}
