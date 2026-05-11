'use client';

import { useState, useEffect, useCallback } from 'react';

interface UserRow {
  id: string;
  email: string;
  provider: string;
  created_at: string;
  last_sign_in_at: string | null;
  original_count: number;
  child_count: number;
  mastered_count: number;
  category_count: number;
  attempt_count: number;
  correct_count: number;
  accuracy: number;          // %
  last_active_at: string | null;
  active_recently: boolean;  // 최근 24h
}

interface Totals {
  users: number;
  originals: number;
  children: number;
  mastered: number;
  attempts: number;
  active_24h: number;
}

const ADMIN_SECRET = process.env.NEXT_PUBLIC_ADMIN_SECRET || 'qt-admin-2024';

export default function AdminPage() {
  const [password, setPassword] = useState('');
  const [authed, setAuthed] = useState(false);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sortKey, setSortKey] = useState<keyof UserRow>('original_count');

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin', {
        headers: { 'x-admin-secret': ADMIN_SECRET },
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || '오류 발생');
        return;
      }
      const data = await res.json();
      setUsers(data.users || []);
      setTotals(data.totals || null);
    } catch {
      setError('서버 연결 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authed) fetchUsers();
  }, [authed, fetchUsers]);

  function handleLogin() {
    if (password === ADMIN_SECRET) setAuthed(true);
    else setError('비밀번호가 틀렸습니다');
  }

  function fmtDate(d: string | null) {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('ko-KR', {
      year: '2-digit', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  }

  function fmtAgo(d: string | null) {
    if (!d) return '-';
    const diff = Date.now() - new Date(d).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return '방금';
    if (min < 60) return `${min}분 전`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}시간 전`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day}일 전`;
    return fmtDate(d);
  }

  // ── 로그인 ──
  if (!authed) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="bg-gray-900 rounded-2xl p-8 w-80 shadow-2xl">
          <h1 className="text-white text-2xl font-bold mb-1 text-center">🔐 관리자</h1>
          <p className="text-gray-400 text-sm text-center mb-6">BloomLens Admin</p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            placeholder="비밀번호 입력"
            className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 text-sm mb-3 outline-none focus:ring-2 focus:ring-blue-500"
          />
          {error && <p className="text-red-400 text-xs mb-3 text-center">{error}</p>}
          <button
            onClick={handleLogin}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition"
          >
            접속
          </button>
        </div>
      </div>
    );
  }

  const sorted = [...users].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (typeof av === 'number' && typeof bv === 'number') return bv - av;
    return String(bv).localeCompare(String(av));
  });

  // ── 대시보드 ──
  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black">🛠️ BloomLens 관리자</h1>
          <p className="text-gray-400 text-sm mt-1">유저 · 원본문제 · 유사문제 · 풀이 통계 (실시간)</p>
        </div>
        <button
          onClick={fetchUsers}
          disabled={loading}
          className="bg-gray-800 hover:bg-gray-700 text-sm px-4 py-2 rounded-xl transition"
        >
          {loading ? '로딩...' : '🔄 새로고침'}
        </button>
      </div>

      {/* 요약 카드 5개 */}
      {totals && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <SummaryCard label="총 유저" value={totals.users} accent="text-blue-400" />
          <SummaryCard label="원본 문제" value={totals.originals} accent="text-yellow-400" />
          <SummaryCard label="유사문제 (AI)" value={totals.children} accent="text-purple-400" />
          <SummaryCard label="완료(mastered)" value={totals.mastered} accent="text-emerald-400" />
          <SummaryCard label="최근 24h 활동" value={totals.active_24h} accent="text-pink-400" />
        </div>
      )}

      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded-xl p-3 mb-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* 정렬 안내 */}
      <p className="text-xs text-gray-500 mb-2">컬럼 헤더 클릭으로 정렬 (현재: {String(sortKey)})</p>

      {/* 유저 테이블 */}
      {loading ? (
        <div className="text-center text-gray-400 py-16 text-sm">로딩 중...</div>
      ) : (
        <div className="bg-gray-900 rounded-2xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="bg-gray-800 text-gray-400 text-xs">
                <Th label="이메일" onClick={() => setSortKey('email')} />
                <Th label="provider" onClick={() => setSortKey('provider')} center />
                <Th label="카테고리" onClick={() => setSortKey('category_count')} center />
                <Th label="원본" onClick={() => setSortKey('original_count')} center />
                <Th label="유사" onClick={() => setSortKey('child_count')} center />
                <Th label="완료" onClick={() => setSortKey('mastered_count')} center />
                <Th label="시도" onClick={() => setSortKey('attempt_count')} center />
                <Th label="정답률" onClick={() => setSortKey('accuracy')} center />
                <Th label="최근 활동" onClick={() => setSortKey('last_active_at')} />
                <Th label="가입일" onClick={() => setSortKey('created_at')} />
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr><td colSpan={10} className="text-center text-gray-500 py-12">유저 없음</td></tr>
              ) : sorted.map((u) => (
                <tr key={u.id} className="border-t border-gray-800 hover:bg-gray-800/50 transition">
                  <td className="px-3 py-2.5 font-medium">
                    {u.active_recently && <span className="inline-block w-1.5 h-1.5 bg-pink-400 rounded-full mr-2"></span>}
                    {u.email}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${
                      u.provider === 'google' ? 'bg-red-900/50 text-red-300' :
                      u.provider === 'email'  ? 'bg-blue-900/50 text-blue-300' :
                      'bg-gray-800 text-gray-400'
                    }`}>{u.provider}</span>
                  </td>
                  <Cell value={u.category_count} color="text-cyan-400" />
                  <Cell value={u.original_count} color="text-yellow-400" />
                  <Cell value={u.child_count} color="text-purple-400" />
                  <Cell value={u.mastered_count} color="text-emerald-400" />
                  <Cell value={u.attempt_count} color="text-gray-300" />
                  <td className="px-3 py-2.5 text-center">
                    {u.attempt_count > 0 ? (
                      <span className={`font-bold ${
                        u.accuracy >= 70 ? 'text-emerald-400' :
                        u.accuracy >= 40 ? 'text-yellow-400' : 'text-red-400'
                      }`}>{u.accuracy}%</span>
                    ) : <span className="text-gray-600">-</span>}
                  </td>
                  <td className="px-3 py-2.5 text-gray-400 text-xs">{fmtAgo(u.last_active_at)}</td>
                  <td className="px-3 py-2.5 text-gray-400 text-xs">{fmtDate(u.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="bg-gray-900 rounded-2xl p-4">
      <p className="text-gray-400 text-xs mb-1">{label}</p>
      <p className={`text-3xl font-black ${accent}`}>{value}</p>
    </div>
  );
}

function Th({ label, onClick, center }: { label: string; onClick: () => void; center?: boolean }) {
  return (
    <th
      onClick={onClick}
      className={`px-3 py-3 cursor-pointer hover:text-white transition select-none ${center ? 'text-center' : 'text-left'}`}
    >
      {label}
    </th>
  );
}

function Cell({ value, color }: { value: number; color: string }) {
  return (
    <td className="px-3 py-2.5 text-center">
      <span className={`font-bold ${value > 0 ? color : 'text-gray-600'}`}>{value}</span>
    </td>
  );
}
