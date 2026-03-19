'use client';

import { useState, useEffect } from 'react';
import { updatePassword, supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [ready, setReady] = useState(false);

  // Supabase가 URL 해시의 access_token을 세션으로 교환할 때까지 대기
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setReady(true);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function handleSubmit() {
    if (!password || password !== confirm) {
      setError('비밀번호가 일치하지 않아.');
      return;
    }
    if (password.length < 6) {
      setError('비밀번호는 6자 이상이어야 해.');
      return;
    }
    setLoading(true);
    setError('');
    const { error } = await updatePassword(password);
    setLoading(false);
    if (error) {
      setError(error);
    } else {
      setDone(true);
      setTimeout(() => router.push('/'), 2000);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0a2265] to-[#1a3a8f] flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-black text-white tracking-tight">
            Bloom<span className="text-yellow-300">Lens</span>
          </h1>
        </div>

        <div className="bg-white/10 rounded-2xl p-6">
          {done ? (
            <div className="text-center">
              <div className="text-4xl mb-3">✅</div>
              <p className="text-white font-bold">비밀번호 변경 완료!</p>
              <p className="text-blue-200 text-sm mt-1">잠시 후 홈으로 이동할게.</p>
            </div>
          ) : !ready ? (
            <div className="text-center py-4">
              <div className="flex gap-1.5 justify-center">
                {[0,1,2].map(i => (
                  <div key={i} className="w-2 h-2 bg-yellow-300 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
              <p className="text-blue-200 text-sm mt-3">인증 확인 중...</p>
            </div>
          ) : (
            <>
              <p className="text-white font-bold mb-4">새 비밀번호 설정</p>
              <div className="space-y-2">
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="새 비밀번호 (6자 이상)"
                  className="w-full bg-white/20 text-white placeholder-blue-300 rounded-xl px-3 py-2.5 text-sm outline-none focus:bg-white/30"
                />
                <input
                  type="password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                  placeholder="비밀번호 확인"
                  className="w-full bg-white/20 text-white placeholder-blue-300 rounded-xl px-3 py-2.5 text-sm outline-none focus:bg-white/30"
                />
                {error && <p className="text-red-300 text-xs">{error}</p>}
                <button
                  onClick={handleSubmit}
                  disabled={!password || !confirm || loading}
                  className="w-full py-3 rounded-xl bg-yellow-400 text-gray-900 font-bold text-sm disabled:opacity-40 active:scale-95 transition-transform">
                  {loading ? '변경 중...' : '비밀번호 변경'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
