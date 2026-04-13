'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';

// ═══════════════════════════════════════════════
// 타입
// ═══════════════════════════════════════════════
type View = 'loading' | 'home' | 'scan' | 'confirm' | 'quiz' | 'result';
type LoginTab = 'login' | 'signup' | 'reset';
type HomeTab  = 'active' | 'mastered';

interface WrongNoteItem {
  id: string;
  device_id: string;
  subject: string | null;
  topic: string | null;
  question_text: string;
  choices: string[];
  question_type: 'multiple_choice' | 'short_answer' | 'essay';
  correct_answer: string;
  explanation: string | null;
  source: 'scan' | 'generated';
  parent_id: string | null;
  times_wrong: number;
  times_correct: number;
  mastered: boolean;
  last_attempted_at: string | null;
  created_at: string;
}

interface ParsedProblem {
  question_text: string;
  choices: string[];
  marked_answer: string | null;
  correct_answer: string | null;
  subject: string;
  topic: string;
  question_type: string;
}

interface ParseResult {
  problems: ParsedProblem[];
  overall_subject: string;
  source_description: string;
}

interface ConfirmItem {
  problem: ParsedProblem;
  subject: string;
  topic: string;
  selected: boolean;
}

interface QuizAnswer {
  itemId: string;
  isCorrect: boolean;
  studentAnswer: string;
}

// ═══════════════════════════════════════════════
// 유틸
// ═══════════════════════════════════════════════
function normalizeAnswer(raw: string | null | undefined): string {
  if (!raw) return '';
  const s = raw.toString().trim();
  const circled: Record<string, string> = { '①': '1', '②': '2', '③': '3', '④': '4', '⑤': '5' };
  if (circled[s]) return circled[s];
  const m = s.match(/(\d+)/);
  return m ? m[1] : s;
}

function normalizeText(s: string): string {
  return s
    .replace(/\s+/g, '')
    .replace(/＜/g, '<').replace(/＞/g, '>')
    .replace(/≤/g, '<=').replace(/≥/g, '>=')
    .replace(/[=＝]/g, '=')
    .toLowerCase();
}

function isShortAnswerCorrect(student: string, correct: string): boolean {
  if (normalizeText(student) === normalizeText(correct)) return true;
  const sNums = student.match(/-?\d+\.?\d*/g);
  const cNums = correct.match(/-?\d+\.?\d*/g);
  if (sNums && cNums && sNums.join(',') === cNums.join(',')) return true;
  return false;
}

// ─── 수학 텍스트 렌더링 ───
function MathText({ text, className = '' }: { text: string; className?: string }) {
  let processed = text
    .replace(/>=|≥/g, '≥')
    .replace(/<=|≤/g, '≤')
    .replace(/(?<![<\w])<(?![<=\w])/g, '＜')
    .replace(/(?<![<\w])>(?![>=\w])/g, '＞');

  const parts = processed.split(/([a-zA-Z](?=[^a-zA-Z가-힣]|$))/g);
  const elements: React.ReactNode[] = [];
  parts.forEach((part, i) => {
    if (part && /^[a-zA-Z]$/.test(part)) {
      elements.push(
        <span key={i} style={{ fontStyle: 'italic', fontFamily: 'Georgia, "Times New Roman", serif' }}>
          {part}
        </span>
      );
    } else if (part) {
      elements.push(<span key={i}>{part}</span>);
    }
  });
  return <span className={className}>{elements}</span>;
}

// ─── 이미지 압축 ───
async function compressImage(file: File): Promise<File> {
  return new Promise((resolve) => {
    const MAX_WIDTH = 1200;
    const QUALITY = 0.75;
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (img.width <= MAX_WIDTH && file.size < 500_000) { resolve(file); return; }
      const scale = Math.min(1, MAX_WIDTH / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(file); return; }
          resolve(new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }));
        },
        'image/jpeg', QUALITY
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

// ═══════════════════════════════════════════════
// 메인 컴포넌트
// ═══════════════════════════════════════════════
export default function Home() {
  // ─── 뷰 & 인증 ───
  const [view, setView]           = useState<View>('loading');
  const [user, setUser]           = useState<User | null>(null);
  const [loginTab, setLoginTab]   = useState<LoginTab>('login');
  const [loginEmail, setLoginEmail]     = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError]     = useState('');
  const [resetSent, setResetSent]       = useState(false);

  // ─── 오답노트 (홈) ───
  const [wrongNote, setWrongNote]       = useState<WrongNoteItem[]>([]);
  const [homeTab, setHomeTab]           = useState<HomeTab>('active');
  const [filterSubject, setFilterSubject] = useState('');
  const [subjects, setSubjects]         = useState<Record<string, number>>({});
  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set());
  const [noteLoading, setNoteLoading]   = useState(false);
  const [generating, setGenerating]     = useState(false);

  // ─── 스캔 ───
  const [imageFile, setImageFile]       = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [parsing, setParsing]           = useState(false);
  const [parseResult, setParseResult]   = useState<ParseResult | null>(null);
  const cameraRef  = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  // ─── 카테고리 확인 ───
  const [confirmItems, setConfirmItems] = useState<ConfirmItem[]>([]);
  const [saving, setSaving]             = useState(false);

  // ─── 퀴즈 ───
  const [quizItems, setQuizItems]       = useState<WrongNoteItem[]>([]);
  const [quizSource, setQuizSource]     = useState<'wrong_note' | 'generated'>('wrong_note');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);
  const [textAnswer, setTextAnswer]     = useState('');
  const [quizAnswers, setQuizAnswers]   = useState<QuizAnswer[]>([]);
  const [score, setScore]               = useState({ correct: 0, total: 0 });
  const [newlyMastered, setNewlyMastered] = useState<string[]>([]); // mastered된 item id들

  // ════════════════════════════════════════
  // 인증 초기화
  // ════════════════════════════════════════
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setView(session?.user ? 'home' : 'home'); // home에서 비로그인 처리
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) setView('home');
    });
    return () => subscription.unsubscribe();
  }, []);

  // ════════════════════════════════════════
  // 오답노트 로드
  // ════════════════════════════════════════
  const loadWrongNote = useCallback(async () => {
    if (!user) return;
    setNoteLoading(true);
    try {
      const params = new URLSearchParams({ device_id: user.id });
      const res = await fetch(`/api/wrong-note?${params}`);
      const data = await res.json();
      setWrongNote(data.items || []);
      setSubjects(data.subjects || {});
    } catch { /* ignore */ }
    finally { setNoteLoading(false); }
  }, [user]);

  useEffect(() => {
    if (view === 'home' && user) loadWrongNote();
  }, [view, user, loadWrongNote]);

  // ════════════════════════════════════════
  // 인증 함수
  // ════════════════════════════════════════
  const handleLogin = async () => {
    setLoginError('');
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: loginEmail, password: loginPassword,
      });
      if (error) setLoginError(error.message);
    } catch { setLoginError('로그인 오류가 발생했습니다.'); }
  };

  const handleSignup = async () => {
    setLoginError('');
    try {
      const { error } = await supabase.auth.signUp({
        email: loginEmail, password: loginPassword,
      });
      if (error) setLoginError(error.message);
      else setLoginError('이메일 확인 후 로그인해주세요.');
    } catch { setLoginError('회원가입 오류가 발생했습니다.'); }
  };

  const handleReset = async () => {
    setLoginError('');
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(loginEmail, {
        redirectTo: `${window.location.origin}/auth/reset-password`,
      });
      if (error) setLoginError(error.message);
      else setResetSent(true);
    } catch { setLoginError('오류가 발생했습니다.'); }
  };

  const handleGoogleLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setWrongNote([]); setSelectedIds(new Set()); setFilterSubject('');
  };

  // ════════════════════════════════════════
  // 스캔 함수
  // ════════════════════════════════════════
  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const compressed = await compressImage(file);
    setImageFile(compressed);
    setImagePreview(URL.createObjectURL(compressed));
    setParseResult(null);
  };

  const handleParseImage = async () => {
    if (!imageFile) return;
    setParsing(true);
    try {
      const formData = new FormData();
      formData.append('image', imageFile);
      const res = await fetch('/api/parse-image', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setParseResult(data);
      // 카테고리 확인 화면 준비
      const items: ConfirmItem[] = data.problems.map((p: ParsedProblem) => ({
        problem: p,
        subject: p.subject || data.overall_subject || '',
        topic: p.topic || '',
        selected: true,
      }));
      setConfirmItems(items);
      setView('confirm');
    } catch (e) {
      alert('이미지 분석에 실패했습니다. 다시 시도해주세요.');
      console.error(e);
    } finally { setParsing(false); }
  };

  // ════════════════════════════════════════
  // 카테고리 확인 → wrong_note 저장
  // ════════════════════════════════════════
  const handleSaveToWrongNote = async () => {
    if (!user) return;
    const toSave = confirmItems.filter(ci => ci.selected && ci.problem.correct_answer);
    if (!toSave.length) { alert('저장할 문제를 선택해주세요.'); return; }

    setSaving(true);
    try {
      const items = toSave.map(ci => ({
        subject: ci.subject || null,
        topic: ci.topic || null,
        question_text: ci.problem.question_text,
        choices: ci.problem.choices || [],
        question_type: ci.problem.question_type || 'multiple_choice',
        correct_answer: ci.problem.correct_answer!,
        source: 'scan',
      }));
      const res = await fetch('/api/wrong-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: user.id, items }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      // 홈으로 돌아가서 오답노트 새로고침
      setView('home');
      setImageFile(null); setImagePreview(null); setParseResult(null); setConfirmItems([]);
    } catch (e) {
      alert('저장에 실패했습니다.');
      console.error(e);
    } finally { setSaving(false); }
  };

  // ════════════════════════════════════════
  // 오답노트 선택/퀴즈 시작
  // ════════════════════════════════════════
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const startQuiz = (items: WrongNoteItem[], source: 'wrong_note' | 'generated' = 'wrong_note') => {
    if (!items.length) return;
    setQuizItems(items);
    setQuizSource(source);
    setCurrentIndex(0);
    setSelectedAnswer(null);
    setShowExplanation(false);
    setTextAnswer('');
    setScore({ correct: 0, total: 0 });
    setQuizAnswers([]);
    setNewlyMastered([]);
    setView('quiz');
  };

  const handleStartQuizFromSelected = () => {
    const selected = wrongNote.filter(item => selectedIds.has(item.id));
    startQuiz(selected, 'wrong_note');
  };

  // ─── 유사문제 생성 ───
  const handleGenerateSimilar = async () => {
    if (!user || selectedIds.size === 0) return;
    const selected = wrongNote.filter(item => selectedIds.has(item.id));
    setGenerating(true);
    try {
      const allGenerated: WrongNoteItem[] = [];
      for (const item of selected) {
        const countPer = Math.max(1, Math.ceil(3 / selected.length));
        const res = await fetch('/api/generate-similar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ originalItem: item, device_id: user.id, count: countPer }),
        });
        const data = await res.json();
        if (data.items) allGenerated.push(...data.items);
      }
      if (allGenerated.length > 0) {
        startQuiz(allGenerated, 'generated');
      } else {
        alert('유사문제 생성에 실패했습니다.');
      }
    } catch {
      alert('유사문제 생성 오류가 발생했습니다.');
    } finally { setGenerating(false); }
  };

  // ════════════════════════════════════════
  // 퀴즈 채점
  // ════════════════════════════════════════
  const processAnswer = (answer: string, isCorrect: boolean) => {
    setSelectedAnswer(answer);
    setShowExplanation(true);
    setScore(prev => ({ correct: prev.correct + (isCorrect ? 1 : 0), total: prev.total + 1 }));
    const item = quizItems[currentIndex];
    setQuizAnswers(prev => [...prev, { itemId: item.id, isCorrect, studentAnswer: answer }]);
  };

  const handleChoiceAnswer = (idx: number) => {
    if (selectedAnswer !== null) return;
    const answer = String(idx + 1);
    const isCorrect = answer === normalizeAnswer(quizItems[currentIndex].correct_answer);
    processAnswer(answer, isCorrect);
  };

  const handleTextSubmit = () => {
    if (selectedAnswer !== null || !textAnswer.trim()) return;
    const item = quizItems[currentIndex];
    const isEssay = item.question_type === 'essay';
    const isCorrect = isEssay ? false : isShortAnswerCorrect(textAnswer.trim(), item.correct_answer);
    processAnswer(textAnswer.trim(), isCorrect);
  };

  const nextProblem = async () => {
    if (currentIndex + 1 >= quizItems.length) {
      // 퀴즈 완료 → wrong_note 통계 업데이트
      if (quizAnswers.length > 0) {
        try {
          const attempts = quizAnswers.map(qa => ({ id: qa.itemId, is_correct: qa.isCorrect }));
          const res = await fetch('/api/wrong-note/attempt', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ attempts }),
          });
          const data = await res.json();
          // 새로 마스터된 항목 체크
          const mastered = (data.updated || [])
            .filter((u: { mastered: boolean }) => u.mastered)
            .map((u: { id: string }) => u.id);
          setNewlyMastered(mastered);
        } catch { /* ignore */ }
      }
      setView('result');
      return;
    }
    setCurrentIndex(prev => prev + 1);
    setSelectedAnswer(null);
    setShowExplanation(false);
    setTextAnswer('');
  };

  // ════════════════════════════════════════
  // 필터된 오답노트
  // ════════════════════════════════════════
  const filteredNote = wrongNote.filter(item => {
    if (homeTab === 'active' && item.mastered) return false;
    if (homeTab === 'mastered' && !item.mastered) return false;
    if (filterSubject && item.subject !== filterSubject) return false;
    return true;
  });

  const activeCount   = wrongNote.filter(i => !i.mastered).length;
  const masteredCount = wrongNote.filter(i => i.mastered).length;

  // ════════════════════════════════════════
  // 렌더
  // ════════════════════════════════════════

  // ─── 로딩 ───
  if (view === 'loading') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-slate-400 text-sm">로딩 중...</div>
      </div>
    );
  }

  // ─── 비로그인 ───
  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#1B3F8B] to-[#0F2560] flex items-center justify-center px-4">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden">
          {/* 로고 영역 */}
          <div className="bg-[#1B3F8B] px-6 py-8 text-center">
            <img
              src="https://www.seoil.ac.kr/sites/seoil/images/common/logo.png"
              alt="서일대학교"
              className="h-8 mx-auto mb-4 opacity-90"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            <h1 className="text-white text-2xl font-bold">BloomLens</h1>
            <p className="text-blue-200 text-sm mt-1">서일대학교만의 특별한 AI 학습법</p>
          </div>

          <div className="p-6 space-y-3">
            {/* Google 로그인 */}
            <button
              onClick={handleGoogleLogin}
              className="w-full flex items-center justify-center gap-2 border border-slate-200 rounded-xl py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
            >
              <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"/><path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z"/></svg>
              Google로 계속하기
            </button>

            <div className="flex items-center gap-3 text-xs text-slate-400">
              <div className="flex-1 border-t border-slate-200" />
              <span>또는</span>
              <div className="flex-1 border-t border-slate-200" />
            </div>

            {/* 탭 */}
            {loginTab !== 'reset' && (
              <div className="flex border border-slate-200 rounded-xl overflow-hidden text-sm">
                {(['login', 'signup'] as LoginTab[]).map(tab => (
                  <button
                    key={tab}
                    onClick={() => { setLoginTab(tab); setLoginError(''); }}
                    className={`flex-1 py-2 font-medium transition ${
                      loginTab === tab ? 'bg-[#1B3F8B] text-white' : 'text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    {tab === 'login' ? '로그인' : '회원가입'}
                  </button>
                ))}
              </div>
            )}

            {/* 입력 폼 */}
            {loginTab !== 'reset' ? (
              <>
                <input
                  type="email"
                  placeholder="이메일 주소"
                  value={loginEmail}
                  onChange={e => setLoginEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && (loginTab === 'login' ? handleLogin() : handleSignup())}
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#1B3F8B] transition"
                />
                <input
                  type="password"
                  placeholder="비밀번호"
                  value={loginPassword}
                  onChange={e => setLoginPassword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && (loginTab === 'login' ? handleLogin() : handleSignup())}
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#1B3F8B] transition"
                />
                <button
                  onClick={loginTab === 'login' ? handleLogin : handleSignup}
                  className="w-full bg-[#1B3F8B] text-white rounded-xl py-3 text-sm font-bold hover:bg-[#163272] transition"
                >
                  {loginTab === 'login' ? '로그인' : '회원가입'}
                </button>
                <button
                  onClick={() => { setLoginTab('reset'); setLoginError(''); setResetSent(false); }}
                  className="w-full text-center text-xs text-slate-400 hover:text-[#1B3F8B] transition py-1"
                >
                  비밀번호를 잊었어?
                </button>
              </>
            ) : (
              <>
                {resetSent ? (
                  <div className="text-center py-4 text-sm text-green-600 font-medium">
                    ✅ 재설정 이메일을 보냈어요.<br/>
                    <span className="text-slate-400 font-normal">메일함을 확인해주세요.</span>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-slate-500 text-center">이메일을 입력하면<br/>비밀번호 재설정 링크를 보내드려요.</p>
                    <input
                      type="email"
                      placeholder="이메일 주소"
                      value={loginEmail}
                      onChange={e => setLoginEmail(e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#1B3F8B] transition"
                    />
                    <button
                      onClick={handleReset}
                      className="w-full bg-[#1B3F8B] text-white rounded-xl py-3 text-sm font-bold hover:bg-[#163272] transition"
                    >
                      재설정 링크 보내기
                    </button>
                  </>
                )}
                <button
                  onClick={() => { setLoginTab('login'); setLoginError(''); }}
                  className="w-full text-center text-xs text-slate-400 hover:text-[#1B3F8B] transition py-1"
                >
                  ← 로그인으로 돌아가기
                </button>
              </>
            )}

            {loginError && (
              <p className="text-xs text-red-500 text-center">{loginError}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── 홈 (오답노트) ───
  if (view === 'home') {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col max-w-lg mx-auto">
        {/* 헤더 */}
        <div className="bg-white border-b border-slate-100 px-4 py-3 flex items-center justify-between sticky top-0 z-20">
          <div className="flex items-center gap-2">
            <span className="text-[#1B3F8B] font-black text-lg tracking-tight">Bloom<span className="text-amber-500">Lens</span></span>
            <span className="text-xs bg-[#1B3F8B]/10 text-[#1B3F8B] rounded-full px-2 py-0.5 font-medium">오답노트</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 max-w-[120px] truncate">{user.email}</span>
            <button onClick={handleLogout} className="text-xs text-slate-400 hover:text-slate-600 transition">로그아웃</button>
          </div>
        </div>

        {/* 탭 (학습중/완료) */}
        <div className="bg-white border-b border-slate-100 px-4 flex gap-0">
          {[
            { key: 'active',   label: `학습 중`, count: activeCount },
            { key: 'mastered', label: `완료`,    count: masteredCount },
          ].map(({ key, label, count }) => (
            <button
              key={key}
              onClick={() => { setHomeTab(key as HomeTab); setSelectedIds(new Set()); }}
              className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition ${
                homeTab === key
                  ? 'border-[#1B3F8B] text-[#1B3F8B]'
                  : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
            >
              {label}
              <span className={`text-xs rounded-full px-1.5 py-0.5 ${
                homeTab === key ? 'bg-[#1B3F8B] text-white' : 'bg-slate-100 text-slate-500'
              }`}>{count}</span>
            </button>
          ))}
        </div>

        {/* 과목 필터 칩 */}
        {Object.keys(subjects).length > 0 && (
          <div className="bg-white px-4 py-2 flex gap-2 overflow-x-auto scrollbar-hide">
            <button
              onClick={() => setFilterSubject('')}
              className={`flex-shrink-0 text-xs rounded-full px-3 py-1.5 border transition ${
                !filterSubject ? 'bg-[#1B3F8B] text-white border-[#1B3F8B]' : 'border-slate-200 text-slate-500 hover:border-slate-300'
              }`}
            >
              전체
            </button>
            {Object.keys(subjects).map(s => (
              <button
                key={s}
                onClick={() => setFilterSubject(s === filterSubject ? '' : s)}
                className={`flex-shrink-0 text-xs rounded-full px-3 py-1.5 border transition ${
                  filterSubject === s ? 'bg-[#1B3F8B] text-white border-[#1B3F8B]' : 'border-slate-200 text-slate-500 hover:border-slate-300'
                }`}
              >
                {s} <span className="opacity-70">{subjects[s]}</span>
              </button>
            ))}
          </div>
        )}

        {/* 오답노트 목록 */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 pb-36">
          {noteLoading ? (
            <div className="text-center py-16 text-slate-400 text-sm">불러오는 중...</div>
          ) : filteredNote.length === 0 ? (
            <div className="text-center py-16 space-y-3">
              <div className="text-4xl">{homeTab === 'mastered' ? '🏆' : '📖'}</div>
              <p className="text-slate-500 text-sm">
                {homeTab === 'mastered'
                  ? '아직 완료한 문제가 없어요.'
                  : '시험지를 스캔해서 오답노트를 시작해봐요!'}
              </p>
              {homeTab === 'active' && (
                <button
                  onClick={() => { setImageFile(null); setImagePreview(null); setParseResult(null); setView('scan'); }}
                  className="mt-2 bg-[#1B3F8B] text-white text-sm px-6 py-2.5 rounded-xl font-medium"
                >
                  📷 시험지 스캔하기
                </button>
              )}
            </div>
          ) : (
            filteredNote.map(item => {
              const isSelected = selectedIds.has(item.id);
              return (
                <div
                  key={item.id}
                  onClick={() => toggleSelect(item.id)}
                  className={`bg-white rounded-xl border-2 p-4 cursor-pointer transition select-none ${
                    isSelected ? 'border-[#1B3F8B] shadow-sm' : 'border-slate-100 hover:border-slate-200'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {/* 체크박스 */}
                    <div className={`mt-0.5 w-5 h-5 rounded-md border-2 flex-shrink-0 flex items-center justify-center transition ${
                      isSelected ? 'bg-[#1B3F8B] border-[#1B3F8B]' : 'border-slate-300'
                    }`}>
                      {isSelected && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/></svg>}
                    </div>

                    <div className="flex-1 min-w-0">
                      {/* 태그 */}
                      <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                        {item.subject && (
                          <span className="text-xs bg-[#1B3F8B]/10 text-[#1B3F8B] rounded px-1.5 py-0.5 font-medium">
                            {item.subject}
                          </span>
                        )}
                        {item.topic && (
                          <span className="text-xs bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">
                            {item.topic}
                          </span>
                        )}
                        {item.source === 'generated' && (
                          <span className="text-xs bg-amber-50 text-amber-600 rounded px-1.5 py-0.5">AI생성</span>
                        )}
                      </div>

                      {/* 문제 미리보기 */}
                      <p className="text-sm text-slate-700 line-clamp-2 leading-relaxed">
                        <MathText text={item.question_text} />
                      </p>

                      {/* 틀린 횟수 인디케이터 */}
                      <div className="flex items-center gap-3 mt-2">
                        <div className="flex items-center gap-1">
                          {Array.from({ length: 3 }).map((_, i) => (
                            <div
                              key={i}
                              className={`w-2 h-2 rounded-full ${
                                i < item.times_correct ? 'bg-emerald-400' : 'bg-slate-200'
                              }`}
                            />
                          ))}
                          <span className="text-xs text-slate-400 ml-1">
                            {item.times_correct}/3 맞춤
                          </span>
                        </div>
                        {item.times_wrong > 0 && (
                          <span className="text-xs text-red-400">{item.times_wrong}번 틀림</span>
                        )}
                      </div>
                    </div>

                    {/* 마스터 뱃지 */}
                    {item.mastered && (
                      <span className="flex-shrink-0 text-lg">🏆</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* FAB: 스캔 버튼 */}
        <div className="fixed bottom-24 right-4 z-30">
          <button
            onClick={() => { setImageFile(null); setImagePreview(null); setParseResult(null); setView('scan'); }}
            className="w-14 h-14 bg-[#1B3F8B] text-white rounded-full shadow-lg flex items-center justify-center text-2xl hover:bg-[#163272] transition active:scale-95"
            title="시험지 스캔"
          >
            +
          </button>
        </div>

        {/* 하단 액션 바 (선택 시) */}
        {selectedIds.size > 0 && (
          <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto bg-white border-t border-slate-200 px-4 py-3 z-20 shadow-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-slate-700">{selectedIds.size}개 선택</span>
              <button onClick={() => setSelectedIds(new Set())} className="text-xs text-slate-400 hover:text-slate-600">
                선택 해제
              </button>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleStartQuizFromSelected}
                className="flex-1 bg-[#1B3F8B] text-white rounded-xl py-3 text-sm font-bold hover:bg-[#163272] transition"
              >
                다시 풀기
              </button>
              <button
                onClick={handleGenerateSimilar}
                disabled={generating}
                className="flex-1 bg-amber-500 text-white rounded-xl py-3 text-sm font-bold hover:bg-amber-600 transition disabled:opacity-60"
              >
                {generating ? '생성 중...' : '✨ 유사문제'}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── 스캔 ───
  if (view === 'scan') {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col max-w-lg mx-auto">
        {/* 헤더 */}
        <div className="bg-white border-b border-slate-100 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
          <button onClick={() => setView('home')} className="text-slate-400 hover:text-slate-600 transition">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/>
            </svg>
          </button>
          <h1 className="font-bold text-slate-800">시험지 스캔</h1>
        </div>

        <div className="flex-1 p-4 space-y-4">
          {/* 이미지 업로드 영역 */}
          <div
            className="bg-white rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center min-h-[220px] cursor-pointer hover:border-[#1B3F8B] transition overflow-hidden relative"
            onClick={() => galleryRef.current?.click()}
          >
            {imagePreview ? (
              <img src={imagePreview} alt="preview" className="w-full object-contain max-h-72" />
            ) : (
              <div className="text-center py-12 space-y-2">
                <div className="text-5xl">📷</div>
                <p className="text-slate-500 text-sm font-medium">사진을 선택하세요</p>
                <p className="text-slate-400 text-xs">시험지, 오답, 교재 등</p>
              </div>
            )}
          </div>

          {/* 촬영/갤러리 버튼 */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => cameraRef.current?.click()}
              className="bg-white border border-slate-200 rounded-xl py-3 text-sm font-medium text-slate-600 hover:border-[#1B3F8B] hover:text-[#1B3F8B] transition flex items-center justify-center gap-2"
            >
              <span>📸</span> 카메라 촬영
            </button>
            <button
              onClick={() => galleryRef.current?.click()}
              className="bg-white border border-slate-200 rounded-xl py-3 text-sm font-medium text-slate-600 hover:border-[#1B3F8B] hover:text-[#1B3F8B] transition flex items-center justify-center gap-2"
            >
              <span>🖼️</span> 갤러리 선택
            </button>
          </div>

          <input ref={cameraRef}  type="file" accept="image/*" capture="environment" className="hidden" onChange={handleImageSelect} />
          <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />

          {/* 분석 버튼 */}
          {imageFile && (
            <button
              onClick={handleParseImage}
              disabled={parsing}
              className="w-full bg-[#1B3F8B] text-white rounded-xl py-4 text-base font-bold hover:bg-[#163272] transition disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {parsing ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  AI 분석 중...
                </>
              ) : (
                <>🔍 문제 분석하기</>
              )}
            </button>
          )}
        </div>
      </div>
    );
  }

  // ─── 카테고리 확인 ───
  if (view === 'confirm') {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col max-w-lg mx-auto">
        <div className="bg-white border-b border-slate-100 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
          <button onClick={() => setView('scan')} className="text-slate-400 hover:text-slate-600 transition">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/>
            </svg>
          </button>
          <div className="flex-1">
            <h1 className="font-bold text-slate-800">카테고리 확인</h1>
            <p className="text-xs text-slate-400">과목/단원을 수정하고 오답노트에 저장해요</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 pb-28">
          {confirmItems.map((ci, idx) => (
            <div
              key={idx}
              className={`bg-white rounded-xl border-2 p-4 transition ${
                ci.selected ? 'border-[#1B3F8B]' : 'border-slate-100 opacity-60'
              }`}
            >
              {/* 선택 토글 */}
              <div className="flex items-start gap-3">
                <div
                  className={`mt-0.5 w-5 h-5 rounded-md border-2 flex-shrink-0 flex items-center justify-center cursor-pointer transition ${
                    ci.selected ? 'bg-[#1B3F8B] border-[#1B3F8B]' : 'border-slate-300'
                  }`}
                  onClick={() => setConfirmItems(prev => prev.map((c, i) => i === idx ? { ...c, selected: !c.selected } : c))}
                >
                  {ci.selected && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/></svg>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-700 mb-3 leading-relaxed">
                    <MathText text={ci.problem.question_text} />
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">과목</label>
                      <input
                        type="text"
                        value={ci.subject}
                        onChange={e => setConfirmItems(prev => prev.map((c, i) => i === idx ? { ...c, subject: e.target.value } : c))}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#1B3F8B] transition"
                        placeholder="예: 수학"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">단원</label>
                      <input
                        type="text"
                        value={ci.topic}
                        onChange={e => setConfirmItems(prev => prev.map((c, i) => i === idx ? { ...c, topic: e.target.value } : c))}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#1B3F8B] transition"
                        placeholder="예: 이차함수"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto bg-white border-t border-slate-100 px-4 py-3 z-20">
          <p className="text-xs text-slate-400 text-center mb-2">
            선택한 {confirmItems.filter(c => c.selected).length}개 문제를 오답노트에 저장합니다
          </p>
          <button
            onClick={handleSaveToWrongNote}
            disabled={saving || confirmItems.filter(c => c.selected).length === 0}
            className="w-full bg-[#1B3F8B] text-white rounded-xl py-4 text-base font-bold hover:bg-[#163272] transition disabled:opacity-60"
          >
            {saving ? '저장 중...' : '📖 오답노트에 저장'}
          </button>
        </div>
      </div>
    );
  }

  // ─── 퀴즈 ───
  if (view === 'quiz') {
    const item = quizItems[currentIndex];
    const isMultiple = item.question_type === 'multiple_choice';
    const isEssay = item.question_type === 'essay';
    const progress = ((currentIndex) / quizItems.length) * 100;

    return (
      <div className="min-h-screen bg-slate-50 flex flex-col max-w-lg mx-auto">
        {/* 헤더 */}
        <div className="bg-white border-b border-slate-100 px-4 py-3 sticky top-0 z-10">
          <div className="flex items-center justify-between mb-2">
            <button
              onClick={() => { if (window.confirm('퀴즈를 종료할까요?')) setView('home'); }}
              className="text-slate-400 hover:text-slate-600"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
            <span className="text-sm font-medium text-slate-600">
              {currentIndex + 1} / {quizItems.length}
            </span>
            <div className="text-sm font-bold text-emerald-600">{score.correct}점</div>
          </div>
          {/* 진행 바 */}
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#1B3F8B] rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 pb-6 space-y-4">
          {/* 태그 */}
          <div className="flex gap-1.5 flex-wrap">
            {item.subject && <span className="text-xs bg-[#1B3F8B]/10 text-[#1B3F8B] rounded px-2 py-0.5">{item.subject}</span>}
            {item.topic && <span className="text-xs bg-slate-100 text-slate-500 rounded px-2 py-0.5">{item.topic}</span>}
            {quizSource === 'generated' && <span className="text-xs bg-amber-50 text-amber-600 rounded px-2 py-0.5">AI생성</span>}
          </div>

          {/* 문제 */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <p className="text-base text-slate-800 leading-relaxed">
              <MathText text={item.question_text} />
            </p>
          </div>

          {/* 선택지 or 입력 */}
          {isMultiple ? (
            <div className="space-y-2">
              {(item.choices || []).map((choice, idx) => {
                const answerNum = String(idx + 1);
                const isCorrect = answerNum === normalizeAnswer(item.correct_answer);
                const isSelected = selectedAnswer === answerNum;
                let btnClass = 'bg-white border-slate-200 text-slate-700';
                if (selectedAnswer !== null) {
                  if (isCorrect) btnClass = 'bg-emerald-50 border-emerald-400 text-emerald-700';
                  else if (isSelected) btnClass = 'bg-red-50 border-red-400 text-red-700';
                  else btnClass = 'bg-white border-slate-100 text-slate-400';
                }
                return (
                  <button
                    key={idx}
                    onClick={() => handleChoiceAnswer(idx)}
                    disabled={selectedAnswer !== null}
                    className={`w-full text-left border-2 rounded-xl px-4 py-3.5 text-sm font-medium transition ${btnClass} disabled:cursor-default`}
                  >
                    <MathText text={choice} />
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2">
              <textarea
                value={textAnswer}
                onChange={e => setTextAnswer(e.target.value)}
                disabled={selectedAnswer !== null}
                placeholder={isEssay ? '풀이 과정을 서술하세요.' : '정답을 입력하세요.'}
                rows={isEssay ? 5 : 2}
                className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#1B3F8B] transition disabled:bg-slate-50 resize-none"
              />
              {selectedAnswer === null && (
                <button
                  onClick={handleTextSubmit}
                  disabled={!textAnswer.trim()}
                  className="w-full bg-[#1B3F8B] text-white rounded-xl py-3 text-sm font-bold hover:bg-[#163272] transition disabled:opacity-40"
                >
                  제출
                </button>
              )}
            </div>
          )}

          {/* 결과 + 해설 */}
          {showExplanation && (
            <div className={`rounded-2xl p-4 ${
              selectedAnswer === normalizeAnswer(item.correct_answer) || (item.question_type === 'short_answer' && isShortAnswerCorrect(selectedAnswer || '', item.correct_answer))
                ? 'bg-emerald-50 border border-emerald-200'
                : 'bg-red-50 border border-red-200'
            }`}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">
                  {(selectedAnswer === normalizeAnswer(item.correct_answer)) ||
                   (item.question_type === 'short_answer' && isShortAnswerCorrect(selectedAnswer || '', item.correct_answer))
                    ? '✅' : '❌'}
                </span>
                <span className="text-sm font-bold text-slate-700">
                  정답: <MathText text={item.correct_answer} />
                </span>
              </div>
              {item.explanation && (
                <p className="text-sm text-slate-600 leading-relaxed">
                  <MathText text={item.explanation} />
                </p>
              )}
            </div>
          )}
        </div>

        {/* 다음 버튼 */}
        {showExplanation && (
          <div className="sticky bottom-0 bg-white border-t border-slate-100 px-4 py-3">
            <button
              onClick={nextProblem}
              className="w-full bg-[#1B3F8B] text-white rounded-xl py-4 text-base font-bold hover:bg-[#163272] transition"
            >
              {currentIndex + 1 >= quizItems.length ? '결과 보기' : '다음 문제 →'}
            </button>
          </div>
        )}
      </div>
    );
  }

  // ─── 결과 ───
  if (view === 'result') {
    const percentage = quizItems.length > 0 ? Math.round((score.correct / quizItems.length) * 100) : 0;
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col max-w-lg mx-auto">
        <div className="bg-white border-b border-slate-100 px-4 py-3">
          <h1 className="font-bold text-slate-800 text-center">퀴즈 결과</h1>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4 pb-28">
          {/* 점수 카드 */}
          <div className="bg-[#1B3F8B] rounded-2xl p-6 text-center text-white">
            <div className="text-5xl font-black mb-1">{percentage}점</div>
            <div className="text-blue-200 text-sm">{score.correct} / {quizItems.length} 정답</div>
          </div>

          {/* 마스터 알림 */}
          {newlyMastered.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-3">
              <span className="text-2xl">🏆</span>
              <div>
                <p className="text-sm font-bold text-amber-700">완료 달성!</p>
                <p className="text-xs text-amber-600">{newlyMastered.length}개 문제를 마스터했어요.</p>
              </div>
            </div>
          )}

          {/* 문제별 결과 */}
          <div className="space-y-2">
            {quizAnswers.map((qa, idx) => {
              const item = quizItems[idx];
              return (
                <div key={idx} className={`bg-white rounded-xl border p-3 ${qa.isCorrect ? 'border-emerald-100' : 'border-red-100'}`}>
                  <div className="flex items-start gap-3">
                    <span className="text-lg flex-shrink-0">{qa.isCorrect ? '✅' : '❌'}</span>
                    <div className="min-w-0">
                      <p className="text-xs text-slate-400 mb-1">
                        {item.subject}{item.topic ? ` · ${item.topic}` : ''}
                      </p>
                      <p className="text-sm text-slate-700 line-clamp-2">
                        <MathText text={item.question_text} />
                      </p>
                      {!qa.isCorrect && (
                        <p className="text-xs text-red-500 mt-1">
                          내 답: {qa.studentAnswer} → 정답: <MathText text={item.correct_answer} />
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto bg-white border-t border-slate-100 px-4 py-3 z-20">
          <button
            onClick={() => { setSelectedIds(new Set()); setView('home'); }}
            className="w-full bg-[#1B3F8B] text-white rounded-xl py-4 text-base font-bold hover:bg-[#163272] transition"
          >
            오답노트로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  return null;
}
