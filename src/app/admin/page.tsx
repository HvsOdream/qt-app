'use client';

import { useState, useEffect, useCallback } from 'react';

interface UserRow {
  id: string;
  email: string;
  provider: string;
  created_at: string;
  last_sign_in_at: string | null;
  question_count: number;
  quiz_count: number;
}

const ADMIN_SECRET = process.env.NEXT_PUBLIC_ADMIN_SECRET || 'qt-admin-2024';

export default function AdminPage() {
  const [password, setPassword] = useState('');
  const [authed, setAuthed] = useState(false);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
    if (password === ADMIN_SECRET) {
      setAuthed(true);
    } else {
      setError('비밀번호가 틀렸습니다');
    }
  }

  function formatDate(dateStr: string | null) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('ko-KR', {
      year: '2-digit', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  }

  const totalQuestions = users.reduce((s, u) => s + u.question_count, 0);
  const totalQuizzes = users.reduce((s, u) => s + u.quiz_count, 0);

  // ── 로그인 화면 ──
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

  // ── 대시보드 ──
  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black">🛠️ BloomLens 관리자</h1>
          <p className="text-gray-400 text-sm mt-1">유저 목록 · 문제은행 현황</p>
        </div>
        <button
          onClick={fetchUsers}
          disabled={loading}
          className="bg-gray-800 hover:bg-gray-700 text-sm px-4 py-2 rounded-xl transition"
        >
          {loading ? '로딩...' : '🔄 새로고침'}
        </button>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-gray-900 rounded-2xl p-4">
          <p className="text-gray-400 text-xs mb-1">총 유저</p>
          <p className="text-3xl font-black text-blue-400">{users.length}</p>
        </div>
        <div className="bg-gray-900 rounded-2xl p-4">
          <p className="text-gray-400 text-xs mb-1">총 문제 수</p>
          <p className="text-3xl font-black text-yellow-400">{totalQuestions}</p>
        </div>
        <div className="bg-gray-900 rounded-2xl p-4">
          <p className="text-gray-400 text-xs mb-1">총 퀴즈 횟수</p>
          <p className="text-3xl font-black text-green-400">{totalQuizzes}</p>
        </div>
      </div>

      {/* 에러 */}
      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded-xl p-3 mb-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* 유저 테이블 */}
      {loading ? (
        <div className="text-center text-gray-400 py-16 text-sm">로딩 중...</div>
      ) : (
        <div className="bg-gray-900 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-800 text-gray-400 text-xs">
                <th className="text-left px-4 py-3">이메일</th>
                <th className="text-left px-4 py-3">로그인 방식</th>
                <th className="text-center px-4 py-3">문제 수</th>
                <th className="text-center px-4 py-3">퀴즈 횟수</th>
                <th className="text-left px-4 py-3">마지막 로그인</th>
                <th className="text-left px-4 py-3">가입일</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center text-gray-500 py-12">유저 없음</td>
                </tr>
              ) : (
                users
                  .sort((a, b) => b.question_count - a.question_count)
                  .map((u) => (
                    <tr key={u.id} className="border-t border-gray-800 hover:bg-gray-800/50 transition">
                      <td className="px-4 py-3 font-medium">{u.email}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs ${
                          u.provider === 'google'
                            ? 'bg-red-900/50 text-red-300'
                            : 'bg-blue-900/50 text-blue-300'
                        }`}>
                          {u.provider}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`font-bold ${u.question_count > 0 ? 'text-yellow-400' : 'text-gray-500'}`}>
                          {u.question_count}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`font-bold ${u.quiz_count > 0 ? 'text-green-400' : 'text-gray-500'}`}>
                          {u.quiz_count}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{formatDate(u.last_sign_in_at)}</td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{formatDate(u.created_at)}</td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
