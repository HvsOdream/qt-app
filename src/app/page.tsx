'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase, signInWithGoogle, signInWithEmail, signOut, onAuthStateChange } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';

// ─── 타입 ───
interface ParsedProblem {
  question_number: string;
  question_text: string;
  choices: string[];
  marked_answer: string | null;
  correct_answer: string | null;
  is_wrong: boolean | null;
  subject: string;
  topic: string;
  keywords: string[];
  difficulty_guess: number;
}

interface ParseResult {
  problems: ParsedProblem[];
  overall_subject: string;
  source_description: string;
}

interface QuizProblem {
  question_text: string;
  choices: string[];
  correct_answer: string;
  explanation: string;
  bloom_level: number;
  subject?: string;
  topic?: string;
  keywords?: string[];
  difficulty?: number;
  question_type?: string;
}

interface Unit {
  id: string;
  code: string;
  title: string;
  level: number;
  children?: Unit[];
}

// ─── 게이미피케이션 상태 ───
interface GameState {
  xp: number;
  level: number;
  qp: number;
  streak: number;
  lastPlayDate: string;
  totalSolved: number;
  totalCorrect: number;
  onboardDone: boolean;
  categories: string[];
}

const DEFAULT_GAME: GameState = {
  xp: 0, level: 1, qp: 0, streak: 0,
  lastPlayDate: '', totalSolved: 0, totalCorrect: 0,
  onboardDone: false, categories: [],
};

function loadGame(): GameState {
  if (typeof window === 'undefined') return DEFAULT_GAME;
  try {
    const raw = localStorage.getItem('qt_game');
    if (!raw) return DEFAULT_GAME;
    return { ...DEFAULT_GAME, ...JSON.parse(raw) };
  } catch { return DEFAULT_GAME; }
}
function saveGame(g: GameState) {
  if (typeof window === 'undefined') return;
  localStorage.setItem('qt_game', JSON.stringify(g));
}

function xpForLevel(lv: number) { return lv * 200; }
function levelTitle(lv: number) {
  if (lv <= 10) return '초보 학습러';
  if (lv <= 30) return '도전자';
  if (lv <= 50) return '전문가';
  return '마스터';
}

// ─── 메인 컴포넌트 ───
export default function Home() {
  // Auth 상태
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [magicLinkEmail, setMagicLinkEmail] = useState('');
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [magicLinkError, setMagicLinkError] = useState('');

  // 화면 모드
  const [mode, setMode] = useState<
    'loading' | 'login' | 'onboard1' | 'onboard2' | 'onboard3' | 'choice' |
    'home' | 'scan' | 'parsed' | 'quiz' | 'result' | 'quest' | 'profile'
  >('loading');
  const [tab, setTab] = useState<'photo' | 'unit' | 'topics'>('photo');
  const [activeNav, setActiveNav] = useState<'home' | 'scan' | 'quest' | 'analysis' | 'profile'>('home');

  // 게이미피케이션
  const [game, setGame] = useState<GameState>(DEFAULT_GAME);
  const [showLevelUp, setShowLevelUp] = useState(false);
  const [earnedXp, setEarnedXp] = useState(0);
  const [earnedQp, setEarnedQp] = useState(0);
  const [streakBonus, setStreakBonus] = useState(0);
  const [consecutiveCorrect, setConsecutiveCorrect] = useState(0);

  // 사진 업로드 상태
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [selectedParsedIdx, setSelectedParsedIdx] = useState<number[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 단원 선택 상태
  const [units, setUnits] = useState<Unit[]>([]);
  const [selectedUnit, setSelectedUnit] = useState<string>('');
  const [selectedUnitName, setSelectedUnitName] = useState<string>('');

  // 오답 기반 토픽 상태
  interface TopicEntry { topic: string; wrongCount: number; keywords: string[]; lastSeen: string; }
  interface SubjectGroup { subject: string; totalWrong: number; topics: TopicEntry[]; }
  const [topicGroups, setTopicGroups] = useState<SubjectGroup[]>([]);
  const [selectedTopic, setSelectedTopic] = useState<{ subject: string; topic: string; keywords: string[] } | null>(null);

  // 퀴즈 공통 상태
  const [difficulty, setDifficulty] = useState<number>(2);
  const [count, setCount] = useState<number>(3);
  const [problems, setProblems] = useState<QuizProblem[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const [quizAnswers, setQuizAnswers] = useState<{ question: string; studentAnswer: string; correctAnswer: string; isCorrect: boolean; subject?: string; topic?: string; keywords?: string[] }[]>([]);

  // ─── PWA 서비스워커 등록 ───
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  // ─── Auth 초기화 ───
  useEffect(() => {
    // 현재 세션 확인
    const checkSession = async () => {
      if (!supabase) { setAuthLoading(false); setMode('login'); return; }
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUser(session.user);
        initGame();
      } else {
        setMode('login');
      }
      setAuthLoading(false);
    };
    checkSession();

    // Auth 상태 리스너
    const { data: { subscription } } = onAuthStateChange((u) => {
      const authUser = u as User | null;
      setUser(authUser);
      if (authUser) {
        initGame();
      } else {
        setMode('login');
      }
    });
    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── 게임 초기화 (로그인 후) ───
  const initGame = () => {
    const g = loadGame();
    setGame(g);
    const today = new Date().toISOString().slice(0, 10);
    if (g.lastPlayDate && g.lastPlayDate !== today) {
      const last = new Date(g.lastPlayDate);
      const diff = Math.floor((new Date(today).getTime() - last.getTime()) / 86400000);
      if (diff > 1) { g.streak = 0; saveGame(g); setGame({ ...g }); }
    }
    setMode(g.onboardDone ? 'home' : 'onboard1');
  };

  // ─── 데이터 로드 (로그인 후) ───
  useEffect(() => {
    if (!user) return;
    const uid = user.id;
    fetch(`/api/units`).then(r => r.json()).then(d => setUnits(d.units || [])).catch(() => {});
    fetch(`/api/topics?user_id=${uid}`).then(r => r.json()).then(d => setTopicGroups(d.topics || [])).catch(() => {});
  }, [user]);

  // ─── 게이미피케이션 보상 ───
  const grantReward = useCallback((xp: number, qp: number) => {
    setGame(prev => {
      const g = { ...prev };
      g.xp += xp;
      g.qp += qp;
      const today = new Date().toISOString().slice(0, 10);
      if (g.lastPlayDate !== today) {
        const last = g.lastPlayDate ? new Date(g.lastPlayDate) : null;
        const diff = last ? Math.floor((new Date(today).getTime() - last.getTime()) / 86400000) : 999;
        g.streak = diff === 1 ? g.streak + 1 : 1;
        g.lastPlayDate = today;
      }
      // 레벨업 체크
      while (g.xp >= xpForLevel(g.level)) {
        g.xp -= xpForLevel(g.level);
        g.level += 1;
        setShowLevelUp(true);
        setTimeout(() => setShowLevelUp(false), 3000);
      }
      saveGame(g);
      return g;
    });
  }, []);

  // ─── 사진 업로드 핸들러 ───
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setParseResult(null);
    setSelectedParsedIdx([]);
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
      // 틀린 문제만 자동 선택 (is_wrong=true). 판별 불가능하면 전체 선택
      const wrongIdxs = data.problems
        .map((p: ParsedProblem, i: number) => p.is_wrong === true ? i : -1)
        .filter((i: number) => i >= 0);
      setSelectedParsedIdx(wrongIdxs.length > 0 ? wrongIdxs : data.problems.map((_: ParsedProblem, i: number) => i));
      // 자동 카테고리 추가
      if (data.overall_subject) {
        setGame(prev => {
          const g = { ...prev };
          if (!g.categories.includes(data.overall_subject)) {
            g.categories = [...g.categories, data.overall_subject];
          }
          saveGame(g);
          return g;
        });
      }
      setMode('parsed');
    } catch {
      alert('이미지 분석에 실패했습니다. 다시 시도해주세요.');
    } finally { setParsing(false); }
  };

  // ─── 유사 문제 생성 ───
  const generateSimilar = async () => {
    if (!parseResult || selectedParsedIdx.length === 0) return;
    setLoading(true);
    try {
      // 선택한 문제 수에 따라 각 문제당 생성할 개수를 균등 분배
      const perProblem = Math.max(1, Math.ceil(count / selectedParsedIdx.length));

      // 병렬 호출로 속도 향상
      const promises = selectedParsedIdx.map(idx => {
        const original = parseResult.problems[idx];
        return fetch('/api/generate-similar', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ originalProblem: original, count: perProblem, difficulty, user_id: user?.id }),
        }).then(r => r.json());
      });

      const results = await Promise.all(promises);
      const allProblems: QuizProblem[] = [];
      results.forEach(data => { if (data.problems) allProblems.push(...data.problems); });

      if (allProblems.length > 0) {
        // 요청한 수만큼만 잘라서 출제 (섞어서)
        const shuffled = allProblems.sort(() => Math.random() - 0.5).slice(0, count);
        setProblems(shuffled);
        setCurrentIndex(0); setSelectedAnswer(null); setShowExplanation(false);
        setScore({ correct: 0, total: 0 }); setQuizAnswers([]); setConsecutiveCorrect(0);
        setMode('quiz');
      }
    } catch { alert('문제 생성에 실패했습니다.'); }
    finally { setLoading(false); }
  };

  // ─── 단원 기반 생성 ───
  // ─── 토픽 기반 문제 생성 (오답에서 확장) ───
  const generateFromTopic = async () => {
    if (!selectedTopic) return;
    setLoading(true);
    try {
      const res = await fetch('/api/generate-by-topic', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: selectedTopic.subject, topic: selectedTopic.topic, keywords: selectedTopic.keywords, difficulty, count, user_id: user?.id }),
      });
      const data = await res.json();
      if (data.problems) {
        setProblems(data.problems);
        setCurrentIndex(0); setSelectedAnswer(null); setShowExplanation(false);
        setScore({ correct: 0, total: 0 }); setQuizAnswers([]); setConsecutiveCorrect(0);
        setMode('quiz');
      }
    } catch { console.error('토픽 문제 생성 실패'); }
    finally { setLoading(false); }
  };

  const generateFromUnit = async () => {
    if (!selectedUnit) return;
    setLoading(true);
    try {
      const res = await fetch('/api/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unitId: selectedUnit, difficulty, count }),
      });
      const data = await res.json();
      if (data.problems) {
        setProblems(data.problems);
        setCurrentIndex(0); setSelectedAnswer(null); setShowExplanation(false);
        setScore({ correct: 0, total: 0 }); setQuizAnswers([]); setConsecutiveCorrect(0);
        setMode('quiz');
      }
    } catch { console.error('문제 생성 실패'); }
    finally { setLoading(false); }
  };

  // ─── 답 선택 ───
  const handleAnswer = async (answerIdx: number) => {
    if (selectedAnswer !== null) return;
    const answer = String(answerIdx + 1);
    setSelectedAnswer(answer);
    setShowExplanation(true);
    const isCorrect = answer === problems[currentIndex].correct_answer;

    const newConsecutive = isCorrect ? consecutiveCorrect + 1 : 0;
    setConsecutiveCorrect(newConsecutive);

    // XP 계산 (연속 정답 보너스)
    let xpGain = isCorrect ? 20 : 5;
    if (isCorrect && newConsecutive >= 5) xpGain = Math.floor(xpGain * 2);
    else if (isCorrect && newConsecutive >= 3) xpGain = Math.floor(xpGain * 1.5);

    setScore(prev => ({ correct: prev.correct + (isCorrect ? 1 : 0), total: prev.total + 1 }));
    setGame(prev => {
      const g = { ...prev, totalSolved: prev.totalSolved + 1, totalCorrect: prev.totalCorrect + (isCorrect ? 1 : 0) };
      g.xp += xpGain;
      while (g.xp >= xpForLevel(g.level)) { g.xp -= xpForLevel(g.level); g.level += 1; setShowLevelUp(true); setTimeout(() => setShowLevelUp(false), 3000); }
      saveGame(g);
      return g;
    });

    const problem = problems[currentIndex];
    setQuizAnswers(prev => [...prev, { question: problem.question_text, studentAnswer: answer, correctAnswer: problem.correct_answer, isCorrect, subject: problem.subject, topic: problem.topic, keywords: problem.keywords }]);

    try {
      await fetch('/api/save-result', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question_text: problem.question_text, choices: problem.choices, correct_answer: problem.correct_answer, student_answer: answer, is_correct: isCorrect, subject: problem.subject || null, topic: problem.topic || null, keywords: problem.keywords || [], user_id: user?.id }),
      });
    } catch { /* ignore */ }
  };

  // ─── 다음 문제 / 결과 ───
  const nextProblem = () => {
    if (currentIndex + 1 >= problems.length) {
      // 퀴즈 완료 보상
      const qpReward = Math.floor(score.correct * 15 + 10);
      setEarnedXp(score.correct * 20 + (score.total - score.correct) * 5);
      setEarnedQp(qpReward);
      const today = new Date().toISOString().slice(0, 10);
      const isNewDay = game.lastPlayDate !== today;
      setStreakBonus(isNewDay ? 1 : 0);
      setGame(prev => {
        const g = { ...prev, qp: prev.qp + qpReward };
        if (isNewDay) {
          const last = g.lastPlayDate ? new Date(g.lastPlayDate) : null;
          const diff = last ? Math.floor((new Date(today).getTime() - last.getTime()) / 86400000) : 999;
          g.streak = diff <= 1 ? g.streak + 1 : 1;
          g.lastPlayDate = today;
        }
        saveGame(g);
        return g;
      });
      setMode('result');
      return;
    }
    setCurrentIndex(prev => prev + 1);
    setSelectedAnswer(null);
    setShowExplanation(false);
  };

  // ─── 초기화 ───
  const resetAll = () => {
    setMode('home'); setActiveNav('home'); setProblems([]); setParseResult(null);
    setImageFile(null); setImagePreview(null); setSelectedParsedIdx([]);
    setSelectedUnit(''); setSelectedUnitName(''); setQuizAnswers([]);
  };

  const goScan = () => { setMode('scan'); setActiveNav('scan'); };
  const completeOnboard = () => {
    const firstScan = game.totalSolved === 0;
    if (firstScan) grantReward(50, 100); // 첫 스캔 보너스
    setGame(prev => { const g = { ...prev, onboardDone: true }; saveGame(g); return g; });
    setMode('home'); setActiveNav('home');
  };

  const bloomLabels: Record<number, string> = { 1: '기억', 2: '이해', 3: '적용', 4: '분석', 5: '평가' };
  const diffLabels: Record<number, string> = { 1: '하', 2: '중', 3: '상' };

  // ─── 하단 내비 ───
  const BottomNav = () => (
    <div className="fixed bottom-0 left-0 right-0 z-50">
      <div className="max-w-xl mx-auto px-3 pb-2">
        <div className="h-16 bg-white/90 backdrop-blur-xl rounded-2xl shadow-lg shadow-violet-200/30 border border-gray-100 flex items-center justify-around px-2">
          {[
            { id: 'home' as const, icon: '🏠', label: '홈', action: () => { setMode('home'); setActiveNav('home'); } },
            { id: 'scan' as const, icon: '📷', label: '스캔', action: goScan },
            { id: 'quest' as const, icon: '🎮', label: '퀘스트', action: () => { setMode('quest'); setActiveNav('quest'); } },
            { id: 'analysis' as const, icon: '📊', label: '분석', action: () => {} },
            { id: 'profile' as const, icon: '👤', label: '내 정보', action: () => { setMode('profile'); setActiveNav('profile'); } },
          ].map(n => (
            <button key={n.id} onClick={n.action} className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-all ${activeNav === n.id ? 'text-violet-600 bg-violet-50' : 'text-gray-400 hover:text-gray-600'} ${n.id === 'analysis' ? 'opacity-40' : ''}`}>
              <span className="text-lg">{n.icon}</span>
              <span className={`text-xs ${activeNav === n.id ? 'font-semibold' : ''}`}>{n.label}{n.id === 'analysis' ? ' 🔒' : ''}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  // ─── 레벨업 모달 ───
  const LevelUpModal = () => showLevelUp ? (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center animate-fade-in">
      <div className="bg-white border border-violet-300 rounded-3xl p-8 text-center mx-6 animate-bounce-in">
        <div className="text-5xl mb-3">🎊</div>
        <h2 className="text-2xl font-bold text-gray-900 mb-1">레벨 업!</h2>
        <p className="text-violet-600 text-lg font-bold">Lv.{game.level - 1} → Lv.{game.level}</p>
        <p className="text-gray-500 text-sm mt-2">{levelTitle(game.level)}</p>
        <button onClick={() => setShowLevelUp(false)} className="mt-4 px-6 py-2 bg-violet-600 text-white rounded-xl text-sm font-medium">확인</button>
      </div>
    </div>
  ) : null;

  // ─── XP 바 ───
  const XpBar = ({ compact = false }: { compact?: boolean }) => (
    <div className={compact ? 'flex items-center gap-2' : ''}>
      <div className={`flex justify-between text-xs mb-1 ${compact ? 'hidden' : ''}`}>
        <span className="text-gray-500">Lv.{game.level} {levelTitle(game.level)}</span>
        <span className="text-violet-600">{game.xp}/{xpForLevel(game.level)}</span>
      </div>
      <div className={`bg-gray-100 rounded-full overflow-hidden ${compact ? 'flex-1 h-1.5' : 'h-2'}`}>
        <div className="h-full bg-gradient-to-r from-violet-600 to-violet-400 rounded-full transition-all" style={{ width: `${(game.xp / xpForLevel(game.level)) * 100}%` }} />
      </div>
    </div>
  );

  // ═══════════════════════════════════════
  // 로딩
  // ═══════════════════════════════════════
  if (mode === 'loading' || authLoading) return (
    <div className="min-h-screen bg-gradient-to-b from-violet-50 to-white flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-black text-gray-900">Q<span className="text-violet-600">T</span></h1>
        <p className="text-gray-600 text-sm mt-2">틀린 문제가 경험치가 되는 곳</p>
      </div>
    </div>
  );

  // ═══════════════════════════════════════
  // 로그인
  // ═══════════════════════════════════════
  if (mode === 'login') return (
    <div className="min-h-screen bg-gradient-to-b from-violet-50 to-white flex flex-col items-center justify-center px-7">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <h1 className="text-5xl font-black text-gray-900 mb-2">Q<span className="text-violet-600">T</span></h1>
          <p className="text-gray-500 text-sm">틀린 문제가 경험치가 되는 곳</p>
        </div>

        {/* Google 로그인 */}
        <button
          onClick={signInWithGoogle}
          className="w-full flex items-center justify-center gap-3 py-3.5 rounded-2xl bg-white border border-gray-200 shadow-sm text-gray-700 font-medium text-sm hover:bg-gray-50 active:scale-[0.98] transition-all mb-3"
        >
          <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
          Google로 시작하기
        </button>

        {/* 구분선 */}
        <div className="flex items-center gap-3 my-5">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="text-xs text-gray-400">또는</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>

        {/* 이메일 매직링크 */}
        {!magicLinkSent ? (
          <div>
            <input
              type="email"
              placeholder="이메일 주소 입력"
              value={magicLinkEmail}
              onChange={e => { setMagicLinkEmail(e.target.value); setMagicLinkError(''); }}
              className="w-full py-3.5 px-4 rounded-2xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 mb-3"
            />
            {magicLinkError && <p className="text-xs text-red-500 mb-2 px-1">{magicLinkError}</p>}
            <button
              onClick={async () => {
                if (!magicLinkEmail.includes('@')) { setMagicLinkError('올바른 이메일을 입력해주세요'); return; }
                const result = await signInWithEmail(magicLinkEmail);
                if (result?.error) { setMagicLinkError(result.error); }
                else { setMagicLinkSent(true); }
              }}
              className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-violet-600 to-violet-500 text-white font-bold text-sm active:scale-[0.98] transition-transform"
            >
              이메일로 로그인 링크 받기
            </button>
          </div>
        ) : (
          <div className="text-center bg-green-50 border border-green-200 rounded-2xl p-5">
            <div className="text-3xl mb-2">📧</div>
            <p className="text-sm font-bold text-green-800 mb-1">메일을 보냈어요!</p>
            <p className="text-xs text-green-600">{magicLinkEmail}로 보낸<br/>링크를 클릭하면 바로 로그인됩니다</p>
            <button onClick={() => { setMagicLinkSent(false); setMagicLinkEmail(''); }} className="text-xs text-gray-500 mt-3 underline">다른 이메일로 시도</button>
          </div>
        )}

        <p className="text-xs text-gray-400 text-center mt-8 leading-relaxed">
          로그인하면 기기 간 학습 기록이 동기화됩니다.<br/>
          비밀번호 없이 안전하게 시작하세요.
        </p>
      </div>
    </div>
  );

  // ═══════════════════════════════════════
  // 온보딩 1: 핵심 가치
  // ═══════════════════════════════════════
  if (mode === 'onboard1') return (
    <div className="min-h-screen bg-gradient-to-b from-violet-50 to-white flex flex-col px-7 py-14">
      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="text-6xl mb-2">📸</div>
        <div className="text-3xl mt-1">→ 🧠 → ✍️</div>
      </div>
      <div className="text-center mb-8">
        <h2 className="text-xl font-extrabold text-gray-900 leading-relaxed">찍으면, AI가 분석하고<br/>새 문제를 만들어줘요</h2>
        <p className="text-sm text-gray-500 mt-3">시험지든 워크북이든, 과목 상관없이<br/><span className="text-violet-600 font-semibold">사진 한 장</span>이면 충분해요</p>
      </div>
      <div className="flex gap-2 justify-center mb-5">
        <div className="w-6 h-2 rounded-full bg-violet-500" /><div className="w-2 h-2 rounded-full bg-gray-200" /><div className="w-2 h-2 rounded-full bg-gray-200" />
      </div>
      <button onClick={() => setMode('onboard2')} className="w-full py-4 rounded-2xl bg-gradient-to-r from-violet-600 to-violet-500 text-white font-bold text-base">다음</button>
      <button onClick={() => { setGame(prev => { const g = { ...prev, onboardDone: true }; saveGame(g); return g; }); setMode('home'); }} className="text-gray-600 text-sm text-center mt-3 py-2">건너뛰기</button>
    </div>
  );

  // ═══════════════════════════════════════
  // 온보딩 2: 자동 개인화
  // ═══════════════════════════════════════
  if (mode === 'onboard2') return (
    <div className="min-h-screen bg-gradient-to-b from-violet-50 to-white flex flex-col px-7 py-14">
      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="text-6xl mb-4">🎯</div>
        <div className="flex gap-2 flex-wrap justify-center">
          <span className="px-3 py-1.5 rounded-lg text-xs bg-red-100 text-red-600">수학 42%</span>
          <span className="px-3 py-1.5 rounded-lg text-xs bg-yellow-100 text-yellow-600">약점 분석</span>
          <span className="px-3 py-1.5 rounded-lg text-xs bg-green-100 text-green-600">영어 88%</span>
        </div>
      </div>
      <div className="text-center mb-8">
        <h2 className="text-xl font-extrabold text-gray-900 leading-relaxed">풀수록 나를 알아가요</h2>
        <p className="text-sm text-gray-500 mt-3">어떤 문제를 풀었는지, 뭘 틀렸는지<br/>AI가 자동으로 <span className="text-violet-600 font-semibold">약점 맵</span>을 만들어요</p>
      </div>
      <div className="flex gap-2 justify-center mb-5">
        <div className="w-2 h-2 rounded-full bg-gray-200" /><div className="w-6 h-2 rounded-full bg-violet-500" /><div className="w-2 h-2 rounded-full bg-gray-200" />
      </div>
      <button onClick={() => setMode('onboard3')} className="w-full py-4 rounded-2xl bg-gradient-to-r from-violet-600 to-violet-500 text-white font-bold text-base">다음</button>
      <button onClick={() => { setGame(prev => { const g = { ...prev, onboardDone: true }; saveGame(g); return g; }); setMode('home'); }} className="text-gray-600 text-sm text-center mt-3 py-2">건너뛰기</button>
    </div>
  );

  // ═══════════════════════════════════════
  // 온보딩 3: 게이미피케이션 티저
  // ═══════════════════════════════════════
  if (mode === 'onboard3') return (
    <div className="min-h-screen bg-gradient-to-b from-violet-50 to-white flex flex-col px-7 py-14">
      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="text-5xl mb-4">🏆</div>
        <div className="flex gap-2 flex-wrap justify-center">
          {[
            { icon: '⭐', label: 'XP & 레벨', bg: 'bg-violet-100', border: 'border-violet-200', text: 'text-violet-600' },
            { icon: '🏅', label: '뱃지 수집', bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-600' },
            { icon: '🔥', label: '연속 기록', bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-600' },
            { icon: '⚔️', label: '랭킹 경쟁', bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-600' },
          ].map(({ icon, label, bg, border, text }) => (
            <div key={label} className={`${bg} border ${border} rounded-xl px-3 py-2 text-center`}>
              <div className="text-xl">{icon}</div>
              <div className={`text-xs ${text}`}>{label}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="text-center mb-8">
        <h2 className="text-xl font-extrabold text-gray-900 leading-relaxed">공부가 게임이 되는 순간</h2>
        <p className="text-sm text-gray-500 mt-3">경험치, 뱃지, 랭킹, 시즌 챌린지<br/><span className="text-yellow-600 font-semibold">풀수록 해금되는 것들</span>이 기다리고 있어요</p>
      </div>
      <div className="flex gap-2 justify-center mb-5">
        <div className="w-2 h-2 rounded-full bg-gray-200" /><div className="w-2 h-2 rounded-full bg-gray-200" /><div className="w-6 h-2 rounded-full bg-violet-500" />
      </div>
      <button onClick={() => setMode('choice')} className="w-full py-4 rounded-2xl bg-gradient-to-r from-violet-600 to-violet-500 text-white font-bold text-base">시작하기</button>
    </div>
  );

  // ═══════════════════════════════════════
  // 첫 액션 선택
  // ═══════════════════════════════════════
  if (mode === 'choice') return (
    <div className="min-h-screen bg-gradient-to-b from-violet-50 to-white px-6 py-14">
      <div className="text-center mb-6">
        <div className="text-3xl mb-2">👋</div>
        <h2 className="text-lg font-extrabold text-gray-900">어떻게 시작할까요?</h2>
        <p className="text-xs text-gray-500 mt-1">어떤 걸 선택해도 좋아요</p>
      </div>
      <div onClick={() => { completeOnboard(); goScan(); }} className="bg-white shadow-sm border-2 border-violet-300 rounded-2xl p-5 mb-3 cursor-pointer active:scale-[0.98] transition-transform relative">
        <div className="absolute top-3 right-3 bg-violet-600 text-white text-xs font-bold px-2.5 py-0.5 rounded">추천</div>
        <div className="text-3xl mb-2">📸</div>
        <h3 className="text-base font-bold text-gray-900 mb-1">시험지 바로 찍기</h3>
        <p className="text-xs text-gray-500 leading-relaxed">가지고 있는 시험지나 문제집을 바로 찍어보세요.<br/>AI가 과목과 유형을 자동으로 파악해요.</p>
        <div className="text-xs text-yellow-600 font-semibold mt-2">🎁 첫 스캔 보너스 +100 QP</div>
      </div>
      <div onClick={completeOnboard} className="bg-white shadow-sm border border-gray-100 rounded-2xl p-5 cursor-pointer active:scale-[0.98] transition-transform">
        <div className="text-3xl mb-2">🏠</div>
        <h3 className="text-base font-bold text-gray-900 mb-1">홈에서 둘러보기</h3>
        <p className="text-xs text-gray-500 leading-relaxed">먼저 둘러보고, 준비되면 스캔해요.</p>
      </div>
      <p className="text-xs text-gray-600 text-center mt-6">📷 촬영한 사진은 문제 분석에만 사용되며, 서버에 저장되지 않습니다.</p>
    </div>
  );

  // ═══════════════════════════════════════
  // 홈 허브
  // ═══════════════════════════════════════
  if (mode === 'home') return (
    <div className="min-h-screen bg-gradient-to-b from-violet-50 to-white pb-20">
      <div className="max-w-xl mx-auto px-4 pt-6">
        {/* 프로필 바 */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-11 h-11 rounded-full bg-gradient-to-br from-violet-600 to-violet-400 flex items-center justify-center text-xl border-2 border-violet-300">🧠</div>
          <div className="flex-1">
            <div className="text-sm font-bold text-gray-900">Lv.{game.level} {levelTitle(game.level)}</div>
            <XpBar />
          </div>
          <div className="text-center">
            <div className="text-lg">🔥</div>
            <div className="text-xs text-yellow-600 font-bold">{game.streak}일</div>
          </div>
        </div>

        {/* QP / 통계 */}
        <div className="flex gap-2 mb-4">
          <div className="flex-1 bg-yellow-50 border border-yellow-200 rounded-xl px-3 py-2 text-center">
            <div className="text-xs text-yellow-600">QP</div>
            <div className="text-base font-extrabold text-yellow-600">{game.qp}</div>
          </div>
          <div className="flex-1 bg-green-50 border border-green-200 rounded-xl px-3 py-2 text-center">
            <div className="text-xs text-green-600">푼 문제</div>
            <div className="text-base font-extrabold text-green-600">{game.totalSolved}</div>
          </div>
          <div className="flex-1 bg-violet-50 border border-violet-200 rounded-xl px-3 py-2 text-center">
            <div className="text-xs text-violet-600">정답률</div>
            <div className="text-base font-extrabold text-violet-600">{game.totalSolved > 0 ? Math.round((game.totalCorrect / game.totalSolved) * 100) : 0}%</div>
          </div>
        </div>

        {/* 일일 미션 */}
        <div className="bg-white shadow-sm border border-violet-200 rounded-2xl p-4 mb-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-bold text-violet-600">📋 오늘의 미션</span>
            <span className="text-xs text-gray-500">{Math.min(game.totalSolved >= 3 ? 1 : 0, 1) + (game.totalSolved >= 1 ? 1 : 0)}/3</span>
          </div>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between"><span className={game.totalSolved >= 3 ? 'text-gray-500 line-through' : 'text-gray-700'}>{game.totalSolved >= 3 ? '✅' : '⬜'} 문제 3개 풀기</span><span className="text-violet-600">+30 QP</span></div>
            <div className="flex justify-between"><span className="text-gray-700">⬜ 새 시험지 스캔</span><span className="text-violet-600">+50 QP</span></div>
            <div className="flex justify-between"><span className="text-gray-700">⬜ 오답 특훈 1회</span><span className="text-violet-600">+40 QP</span></div>
          </div>
        </div>

        {/* CTA */}
        <button onClick={goScan} className="w-full py-4 rounded-2xl bg-gradient-to-r from-violet-600 to-violet-500 text-white font-bold text-[15px] mb-4">📷 시험지 스캔하기</button>

        {/* 카테고리 */}
        {game.categories.length > 0 && (
          <div className="bg-white shadow-sm border border-gray-100 rounded-2xl p-4 mb-4">
            <div className="text-xs font-bold text-gray-900 mb-2">🏷 내 카테고리</div>
            <div className="flex gap-1.5 flex-wrap">
              {game.categories.map(c => <span key={c} className="px-2.5 py-1 bg-violet-100 text-violet-600 text-xs rounded-lg font-medium">{c}</span>)}
            </div>
          </div>
        )}

        {/* 해금 프리뷰 */}
        <div className="bg-white shadow-sm border border-gray-100 rounded-2xl p-4 opacity-50">
          <div className="text-xs font-bold text-gray-900 mb-2">🔒 해금 대기 중</div>
          <div className="space-y-1 text-xs text-gray-500">
            <div>📊 약점 분석 — {Math.min(game.totalSolved, 10)}/10 문제 풀면 해금</div>
            <div>👥 문제 추천 — {Math.min(game.totalSolved, 30)}/30 문제 달성 시</div>
            <div>⚔️ 랭킹 챌린지 — Lv.{game.level}/5 달성 시</div>
          </div>
        </div>
      </div>
      <BottomNav />
      <LevelUpModal />
    </div>
  );

  // ═══════════════════════════════════════
  // 스캔 화면 (촬영 전 안내 포함)
  // ═══════════════════════════════════════
  if (mode === 'scan') return (
    <div className="min-h-screen bg-gradient-to-b from-violet-50 to-white pb-20">
      <div className="max-w-xl mx-auto px-4 py-6">
        <div className="text-center mb-5">
          <h1 className="text-xl font-bold text-gray-900">📷 시험지 스캔</h1>
          <p className="text-xs text-gray-500 mt-1">틀린 문제를 찍으면 AI가 분석해줘요</p>
        </div>

        {/* 탭 */}
        <div className="flex bg-gray-100 rounded-xl p-1 mb-4">
          <button onClick={() => setTab('photo')} className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${tab === 'photo' ? 'bg-violet-600 text-white' : 'text-gray-500'}`}>📷 사진</button>
          <button onClick={() => { setTab('topics'); fetch('/api/topics').then(r => r.json()).then(d => setTopicGroups(d.topics || [])).catch(() => {}); }} className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${tab === 'topics' ? 'bg-violet-600 text-white' : 'text-gray-500'}`}>🎯 약점 연습</button>
          <button onClick={() => setTab('unit')} className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${tab === 'unit' ? 'bg-violet-600 text-white' : 'text-gray-500'}`}>📚 단원</button>
        </div>

        {/* 사진 탭 */}
        {tab === 'photo' && (
          <>
            <div className="bg-white shadow-sm border border-gray-100 rounded-2xl p-5 mb-4">
              <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={handleImageSelect} className="hidden" />
              {imagePreview ? (
                <div className="relative mb-3">
                  <img src={imagePreview} alt="업로드된 문제" className="w-full rounded-xl border border-gray-200 max-h-72 object-contain bg-gray-100" />
                  <button onClick={() => { setImageFile(null); setImagePreview(null); setParseResult(null); }} className="absolute top-2 right-2 w-7 h-7 bg-black/40 text-white rounded-full flex items-center justify-center text-xs">✕</button>
                </div>
              ) : (
                <button onClick={() => fileInputRef.current?.click()} className="w-full h-44 border-2 border-dashed border-violet-300 rounded-xl flex flex-col items-center justify-center gap-2 text-violet-600/70 hover:border-violet-400 transition-colors mb-3">
                  <span className="text-4xl">📸</span>
                  <span className="text-sm font-medium">사진 찍기 / 이미지 선택</span>
                </button>
              )}

              {/* 촬영 가이드 */}
              <div className="bg-white shadow-sm rounded-xl p-3 text-xs text-gray-400 space-y-1 mb-3">
                <div className="text-xs font-bold text-gray-900 mb-1.5">💡 잘 찍는 법</div>
                <div>✅ 문제 전체가 보이게 찍어주세요</div>
                <div>✅ 밝은 곳에서, 그림자 없이</div>
                <div>✅ 살짝 기울어져도 AI가 읽어요</div>
                <div>✅ 한 장에 여러 문제 OK — 과목 상관없이!</div>
              </div>

              {imageFile && !parsing && (
                <button onClick={handleParseImage} className="w-full py-3 rounded-xl bg-gradient-to-r from-violet-600 to-violet-500 text-white font-medium">문제 분석하기</button>
              )}
              {parsing && (
                <div className="w-full py-3 rounded-xl bg-violet-100 text-violet-500 font-medium text-center text-sm">
                  <span className="inline-block animate-spin mr-2">⏳</span>AI가 문제를 분석하고 있어요...
                </div>
              )}
            </div>

            {game.totalSolved === 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 text-center">
                <span className="text-xs text-yellow-600 font-semibold">🏆 첫 스캔 보너스! +100 QP</span>
              </div>
            )}

            <p className="text-xs text-gray-600 text-center mt-3">📷 촬영한 사진은 분석 후 즉시 삭제됩니다</p>
          </>
        )}

        {/* 약점 연습 탭 */}
        {tab === 'topics' && (
          <>
            <div className="bg-white shadow-sm border border-gray-100 rounded-2xl p-5 mb-4">
              <h2 className="text-sm font-semibold text-gray-900 mb-1">내 약점 주제</h2>
              <p className="text-xs text-gray-500 mb-3">틀린 문제에서 자동으로 수집됩니다</p>
              {topicGroups.length === 0 ? (
                <div className="text-center py-8">
                  <div className="text-3xl mb-2">📷</div>
                  <p className="text-sm text-gray-500">아직 데이터가 없어요</p>
                  <p className="text-xs text-gray-400 mt-1">사진으로 문제를 풀면 약점이 자동으로 쌓여요!</p>
                  <button onClick={() => setTab('photo')} className="mt-4 px-4 py-2 rounded-xl bg-violet-100 text-violet-600 text-xs font-medium">사진으로 시작하기</button>
                </div>
              ) : (
                <div className="space-y-2 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 340px)' }}>
                  {[...topicGroups].sort((a, b) => b.totalWrong - a.totalWrong).map((group, gi) => (
                    <details key={group.subject} className="group" open={gi === 0}>
                      <summary className="cursor-pointer py-2 px-3 rounded-lg hover:bg-gray-50 font-medium text-gray-700 text-xs flex justify-between items-center">
                        <span>{group.subject}</span>
                        <span className="text-violet-500 bg-violet-50 px-2 py-0.5 rounded-full text-[10px]">{group.totalWrong}회 오답</span>
                      </summary>
                      <div className="ml-2 mt-1 space-y-0.5">
                        {[...group.topics].sort((a, b) => b.wrongCount - a.wrongCount).map(t => {
                          const ready = t.wrongCount >= 3;
                          return (
                            <button key={t.topic}
                              onClick={() => ready && setSelectedTopic({ subject: group.subject, topic: t.topic, keywords: t.keywords })}
                              className={`w-full text-left py-1.5 px-3 rounded-lg text-xs transition-colors flex justify-between items-center ${
                                !ready ? 'text-gray-300 cursor-default' :
                                selectedTopic?.topic === t.topic && selectedTopic?.subject === group.subject ? 'bg-violet-100 text-violet-600 font-medium' : 'text-gray-500 hover:bg-gray-50'
                              }`}>
                              <span className="flex items-center gap-1">
                                {t.topic}
                                {!ready && <span className="text-[9px] text-gray-300 ml-1">({3 - t.wrongCount}개 더 필요)</span>}
                              </span>
                              <span className={`text-[10px] ${ready ? 'text-gray-400' : 'text-gray-300'}`}>{t.wrongCount}회</span>
                            </button>
                          );
                        })}
                      </div>
                    </details>
                  ))}
                </div>
              )}
              {selectedTopic && <div className="mt-2 text-xs text-violet-600 bg-violet-100 px-3 py-1.5 rounded-lg">선택: {selectedTopic.subject} &gt; {selectedTopic.topic}</div>}
            </div>
            {selectedTopic && (
              <>
                <div className="bg-white shadow-sm border border-gray-100 rounded-2xl p-5 mb-4">
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <label className="text-xs font-medium text-gray-400 mb-1.5 block">난이도</label>
                      <div className="flex gap-1.5">{[1,2,3].map(d => <button key={d} onClick={() => setDifficulty(d)} className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${difficulty === d ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-500'}`}>{diffLabels[d]}</button>)}</div>
                    </div>
                    <div className="flex-1">
                      <label className="text-xs font-medium text-gray-400 mb-1.5 block">문제 수</label>
                      <select value={count} onChange={e => setCount(Number(e.target.value))} className="w-full py-1.5 px-2 rounded-lg border border-gray-200 bg-gray-100 text-sm text-gray-900">{[3,5,10].map(n => <option key={n} value={n}>{n}문제</option>)}</select>
                    </div>
                  </div>
                </div>
                <button onClick={generateFromTopic} disabled={loading} className="w-full py-4 rounded-2xl bg-gradient-to-r from-violet-600 to-violet-500 text-white font-bold disabled:bg-gray-200 disabled:text-gray-400 transition-colors">
                  {loading ? '문제 생성 중...' : '약점 집중 연습'}
                </button>
              </>
            )}
          </>
        )}

        {/* 단원 탭 */}
        {tab === 'unit' && (
          <>
            <div className="bg-white shadow-sm border border-gray-100 rounded-2xl p-5 mb-4">
              <h2 className="text-sm font-semibold text-gray-900 mb-1">단원 선택</h2>
              <p className="text-xs text-gray-500 mb-3">문제가 쌓이면 단원이 자동 생성돼요!</p>
              {topicGroups.length === 0 ? (
                <div className="text-center py-8">
                  <div className="text-3xl mb-2">📚</div>
                  <p className="text-sm text-gray-500">아직 데이터가 부족합니다</p>
                  <p className="text-xs text-gray-400 mt-1">사진으로 문제를 풀면 단원이 자동으로 만들어져요!</p>
                  <button onClick={() => setTab('photo')} className="mt-4 px-4 py-2 rounded-xl bg-violet-100 text-violet-600 text-xs font-medium">사진으로 시작하기</button>
                </div>
              ) : (
                <div className="space-y-1.5 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 340px)' }}>
                  {[...topicGroups].sort((a, b) => b.totalWrong - a.totalWrong).map((group, gi) => (
                    <details key={group.subject} className="group" open={gi === 0}>
                      <summary className="cursor-pointer py-2 px-3 rounded-lg hover:bg-gray-50 font-medium text-gray-700 text-xs flex justify-between items-center">
                        <span>{group.subject}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-gray-400 text-[10px]">{group.totalWrong}회 오답</span>
                          <span className="text-violet-500 bg-violet-50 px-2 py-0.5 rounded-full text-[10px]">{group.topics.length}개 주제</span>
                        </div>
                      </summary>
                      <div className="ml-3 mt-1 space-y-0.5">
                        {[...group.topics].sort((a, b) => b.wrongCount - a.wrongCount).map(t => {
                          const ready = t.wrongCount >= 3;
                          return (
                            <button key={t.topic}
                              onClick={() => ready && setSelectedTopic({ subject: group.subject, topic: t.topic, keywords: t.keywords })}
                              className={`w-full text-left py-1.5 px-3 rounded-lg text-xs transition-colors flex justify-between items-center ${
                                !ready ? 'text-gray-300 cursor-default' :
                                selectedTopic?.topic === t.topic && selectedTopic?.subject === group.subject ? 'bg-violet-100 text-violet-500 font-medium' : 'text-gray-500 hover:bg-gray-100'
                              }`}>
                              <span className="flex items-center gap-1">
                                {t.topic}
                                {!ready && <span className="text-[9px] text-gray-300 ml-1">({3 - t.wrongCount}개 더 필요)</span>}
                              </span>
                              <span className={`text-[10px] ${ready ? 'text-gray-400' : 'text-gray-300'}`}>{t.wrongCount}회</span>
                            </button>
                          );
                        })}
                      </div>
                    </details>
                  ))}
                </div>
              )}
              {selectedTopic && <div className="mt-2 text-xs text-violet-600 bg-violet-100 px-3 py-1.5 rounded-lg">선택: {selectedTopic.subject} &gt; {selectedTopic.topic}</div>}
            </div>
            {selectedTopic && (
              <>
                <div className="bg-white shadow-sm border border-gray-100 rounded-2xl p-5 mb-4">
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <label className="text-xs font-medium text-gray-400 mb-1.5 block">난이도</label>
                      <div className="flex gap-1.5">{[1,2,3].map(d => <button key={d} onClick={() => setDifficulty(d)} className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${difficulty === d ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-500'}`}>{diffLabels[d]}</button>)}</div>
                    </div>
                    <div className="flex-1">
                      <label className="text-xs font-medium text-gray-400 mb-1.5 block">문제 수</label>
                      <select value={count} onChange={e => setCount(Number(e.target.value))} className="w-full py-1.5 px-2 rounded-lg border border-gray-200 bg-gray-100 text-sm text-gray-900">{[3,5,10].map(n => <option key={n} value={n}>{n}문제</option>)}</select>
                    </div>
                  </div>
                </div>
                <button onClick={generateFromTopic} disabled={loading} className="w-full py-4 rounded-2xl bg-gradient-to-r from-violet-600 to-violet-500 text-white font-bold disabled:bg-gray-200 disabled:text-gray-400 transition-colors">
                  {loading ? '문제 생성 중...' : '단원별 연습'}
                </button>
              </>
            )}
          </>
        )}
      </div>
      <BottomNav />
    </div>
  );

  // ═══════════════════════════════════════
  // 파싱 결과 (촬영 후 안내)
  // ═══════════════════════════════════════
  if (mode === 'parsed' && parseResult) {
    const wrongCount = parseResult.problems.filter(p => p.is_wrong === true).length;
    const correctCount = parseResult.problems.filter(p => p.is_wrong === false).length;
    const unknownCount = parseResult.problems.filter(p => p.is_wrong === null).length;

    return (
    <div className="min-h-screen bg-gradient-to-b from-violet-50 to-white pb-20">
      <div className="max-w-xl mx-auto px-4 py-6">
        <button onClick={goScan} className="text-violet-600 text-sm mb-3 flex items-center gap-1">← 다시 촬영</button>

        {/* 요약 헤더 */}
        <div className="text-center mb-4">
          <h2 className="text-lg font-extrabold text-gray-900">{parseResult.problems.length}문제 발견!</h2>
          <p className="text-xs text-gray-500 mb-2">{parseResult.overall_subject} · {parseResult.source_description}</p>
          <div className="flex justify-center gap-3">
            {wrongCount > 0 && <span className="px-2.5 py-1 bg-red-100 text-red-600 text-xs font-bold rounded-lg">틀림 {wrongCount}</span>}
            {correctCount > 0 && <span className="px-2.5 py-1 bg-green-100 text-green-600 text-xs font-bold rounded-lg">맞음 {correctCount}</span>}
            {unknownCount > 0 && <span className="px-2.5 py-1 bg-gray-100 text-gray-500 text-xs font-bold rounded-lg">판별불가 {unknownCount}</span>}
          </div>
        </div>

        {/* 안내 */}
        <div className="bg-violet-50 border border-violet-200 rounded-xl p-3 mb-4">
          <p className="text-xs text-violet-600 leading-relaxed">
            {wrongCount > 0
              ? `틀린 ${wrongCount}문제가 자동 선택됐어요. 탭해서 추가/제거할 수 있어요.`
              : '연습할 문제를 탭해서 선택해주세요.'}
          </p>
        </div>

        {/* 전체 선택/해제 버튼 */}
        <div className="flex gap-2 mb-3">
          <button onClick={() => {
            const wrongIdxs = parseResult.problems.map((p, i) => p.is_wrong === true ? i : -1).filter(i => i >= 0);
            setSelectedParsedIdx(wrongIdxs.length > 0 ? wrongIdxs : parseResult.problems.map((_, i) => i));
          }} className="px-3 py-1.5 text-xs bg-red-50 text-red-600 border border-red-200 rounded-lg font-medium">
            틀린 것만
          </button>
          <button onClick={() => setSelectedParsedIdx(parseResult.problems.map((_, i) => i))} className="px-3 py-1.5 text-xs bg-violet-50 text-violet-600 border border-violet-200 rounded-lg font-medium">
            전체 선택
          </button>
          <button onClick={() => setSelectedParsedIdx([])} className="px-3 py-1.5 text-xs bg-gray-50 text-gray-500 border border-gray-200 rounded-lg font-medium">
            전체 해제
          </button>
        </div>

        {/* 문제 목록 - 맞음/틀림 표시 */}
        <div className="space-y-2 mb-4">
          {parseResult.problems.map((p, idx) => {
            const isSelected = selectedParsedIdx.includes(idx);
            const statusIcon = p.is_wrong === true ? '❌' : p.is_wrong === false ? '✅' : '❓';
            const borderColor = isSelected
              ? (p.is_wrong === true ? 'border-red-400 bg-red-50/50' : 'border-violet-400')
              : 'border-transparent';

            return (
            <div key={idx} onClick={() => setSelectedParsedIdx(prev => prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx])}
              className={`bg-white shadow-sm rounded-xl p-3 border-2 cursor-pointer transition-all ${borderColor}`}>
              <div className="flex items-start gap-2">
                {/* 체크박스 + 상태 */}
                <div className="flex flex-col items-center gap-1 flex-shrink-0">
                  <div className={`w-5 h-5 rounded flex items-center justify-center text-xs ${isSelected ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-400 border border-gray-200'}`}>
                    {isSelected ? '✓' : ''}
                  </div>
                  <span className="text-sm">{statusIcon}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-xs font-bold text-gray-500">Q{p.question_number || idx + 1}</span>
                    {p.is_wrong === true && p.marked_answer && (
                      <span className="text-xs text-red-500">내 답: {p.marked_answer}번</span>
                    )}
                    {p.correct_answer && (
                      <span className="text-xs text-green-600">정답: {p.correct_answer}번</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-700 leading-relaxed line-clamp-2">{p.question_text}</p>
                  <div className="flex gap-1 mt-1.5 flex-wrap">
                    <span className="px-1.5 py-0.5 bg-violet-100 text-violet-600 text-xs rounded">{p.subject}</span>
                    <span className="px-1.5 py-0.5 bg-gray-100 text-gray-400 text-xs rounded">{p.topic}</span>
                  </div>
                </div>
              </div>
            </div>
            );
          })}
        </div>

        {/* 옵션 + 예상 보상 */}
        <div className="flex gap-2 mb-4">
          <div className="flex-1 bg-white shadow-sm rounded-xl p-2.5 text-center">
            <div className="text-xs text-gray-500">문제 수</div>
            <select value={count} onChange={e => setCount(Number(e.target.value))} className="text-sm font-bold text-gray-900 bg-transparent text-center">{[3,5,10].map(n => <option key={n} value={n}>{n}</option>)}</select>
          </div>
          <div className="flex-1 bg-white shadow-sm rounded-xl p-2.5 text-center">
            <div className="text-xs text-gray-500">난이도</div>
            <div className="flex gap-1 mt-1 justify-center">{[1,2,3].map(d => <button key={d} onClick={() => setDifficulty(d)} className={`px-2 py-0.5 rounded text-xs font-medium ${difficulty === d ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-500'}`}>{d===1?'쉽게':d===2?'비슷':'어렵게'}</button>)}</div>
          </div>
          <div className="flex-1 bg-yellow-50 rounded-xl p-2.5 text-center">
            <div className="text-xs text-yellow-600">예상 보상</div>
            <div className="text-sm font-bold text-yellow-600">+{count * 15} QP</div>
          </div>
        </div>

        <button onClick={generateSimilar} disabled={selectedParsedIdx.length === 0 || loading}
          className="w-full py-4 rounded-2xl bg-gradient-to-r from-violet-600 to-violet-500 text-white font-bold disabled:bg-gray-200 disabled:text-gray-400 transition-colors">
          {loading ? <span><span className="inline-block animate-spin mr-2">⏳</span>유사 문제 생성 중...</span> : `⚡ 선택한 ${selectedParsedIdx.length}문제로 연습 시작`}
        </button>
      </div>
      <BottomNav />
    </div>
    );
  }

  // ═══════════════════════════════════════
  // 퀴즈 화면
  // ═══════════════════════════════════════
  if (mode === 'quiz' && problems.length > 0) {
    const problem = problems[currentIndex];
    return (
      <div className="min-h-screen bg-gradient-to-b from-violet-50 to-white">
        <div className="max-w-xl mx-auto px-4 py-6">
          {/* 진행바 + 스트릭 */}
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs text-gray-500">{currentIndex + 1}/{problems.length}</span>
            <div className="flex-1 mx-3 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-violet-600 to-violet-400 rounded-full transition-all" style={{ width: `${((currentIndex + 1) / problems.length) * 100}%` }} />
            </div>
            {consecutiveCorrect >= 2 && <span className="text-xs text-yellow-600 font-bold">🔥 {consecutiveCorrect}연속{consecutiveCorrect >= 5 ? '! x2.0' : consecutiveCorrect >= 3 ? ' x1.5' : ''}</span>}
            <span className="text-xs font-medium text-violet-600 ml-2">{score.correct}/{score.total}</span>
          </div>

          {/* 태그 */}
          <div className="flex gap-1.5 mb-3 flex-wrap">
            {problem.subject && <span className="px-2 py-0.5 bg-violet-100 text-violet-600 text-xs rounded font-medium">{problem.subject}</span>}
            {problem.topic && <span className="px-2 py-0.5 bg-gray-100 text-gray-400 text-xs rounded">{problem.topic}</span>}
            <span className="px-2 py-0.5 bg-yellow-100 text-yellow-600 text-xs rounded">{bloomLabels[problem.bloom_level] || '기타'}</span>
          </div>

          {/* 문제 카드 */}
          <div className="bg-white shadow-sm border border-gray-100 rounded-2xl p-5 mb-4">
            <p className="text-sm font-medium text-gray-900 leading-relaxed whitespace-pre-wrap">{problem.question_text}</p>
          </div>

          {/* 선택지 */}
          <div className="space-y-2.5 mb-4">
            {problem.choices.map((choice, idx) => {
              const num = String(idx + 1);
              const isSelected = selectedAnswer === num;
              const isCorrect = num === problem.correct_answer;
              let cls = 'w-full text-left p-3.5 rounded-xl border-2 transition-all text-sm ';
              if (selectedAnswer === null) cls += 'border-gray-100 hover:border-violet-300 text-gray-700';
              else if (isCorrect) cls += 'border-green-300 bg-green-50 text-green-600';
              else if (isSelected && !isCorrect) cls += 'border-red-300 bg-red-50 text-red-600';
              else cls += 'border-gray-100 text-gray-400';
              return <button key={idx} onClick={() => handleAnswer(idx)} className={cls}>{choice}</button>;
            })}
          </div>

          {/* 해설 */}
          {showExplanation && (
            <>
              {/* 정답/오답 피드백 */}
              <div className={`rounded-xl p-4 mb-3 border ${selectedAnswer === problems[currentIndex].correct_answer ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                <div className="text-xs font-bold mb-1" style={{ color: selectedAnswer === problems[currentIndex].correct_answer ? '#34d399' : '#f87171' }}>
                  {selectedAnswer === problems[currentIndex].correct_answer
                    ? (consecutiveCorrect >= 3 ? '🔥 완벽해요! 연속 정답 보너스!' : '👏 정확해요!')
                    : '아깝다! 핵심 포인트를 확인해봐요'}
                </div>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
                <h3 className="font-semibold text-amber-700 text-xs mb-1.5">해설</h3>
                <p className="text-xs text-amber-600 leading-relaxed whitespace-pre-wrap">{problem.explanation}</p>
              </div>
              <button onClick={nextProblem} className="w-full py-3 rounded-xl bg-gradient-to-r from-violet-600 to-violet-500 text-white font-medium">
                {currentIndex + 1 >= problems.length ? '결과 보기' : '다음 문제'}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════
  // 결과 화면 (보상 포함)
  // ═══════════════════════════════════════
  if (mode === 'result') {
    const pct = score.total > 0 ? Math.round((score.correct / score.total) * 100) : 0;
    const wrongOnes = quizAnswers.filter(a => !a.isCorrect);
    const emoji = pct >= 100 ? '🎉' : pct >= 80 ? '💪' : pct >= 60 ? '👍' : '📚';
    const msg = pct >= 100 ? '퍼펙트! 이 유형은 완전 정복!' : pct >= 80 ? '대단해요! 거의 다 왔어요' : pct >= 60 ? '좋은 시작! 한 번 더 하면 확 달라질 거예요' : '괜찮아요, 틀린 만큼 배우는 거예요';

    return (
      <div className="min-h-screen bg-gradient-to-b from-violet-50 to-white pb-20">
        <div className="max-w-xl mx-auto px-4 py-8">
          {/* 점수 */}
          <div className="text-center mb-5">
            <div className="text-4xl mb-2">{emoji}</div>
            <h2 className="text-xl font-extrabold text-gray-900">{score.correct}/{score.total}</h2>
            <p className="text-sm text-gray-500">정답률 {pct}%</p>
            <p className="text-xs text-violet-600 mt-1">{msg}</p>
          </div>

          {/* 보상 */}
          <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-4 mb-4">
            <div className="text-xs font-bold text-yellow-600 mb-2">🎁 획득한 보상</div>
            <div className="flex gap-2">
              <div className="flex-1 text-center bg-gray-100 rounded-xl py-2.5"><div className="text-lg">⭐</div><div className="text-xs text-yellow-600">+{earnedXp} XP</div></div>
              <div className="flex-1 text-center bg-gray-100 rounded-xl py-2.5"><div className="text-lg">💰</div><div className="text-xs text-yellow-600">+{earnedQp} QP</div></div>
              <div className="flex-1 text-center bg-gray-100 rounded-xl py-2.5"><div className="text-lg">🔥</div><div className="text-xs text-yellow-600">{game.streak}일 연속</div></div>
            </div>
          </div>

          {/* 레벨 진행 */}
          <div className="bg-white shadow-sm border border-gray-100 rounded-2xl p-4 mb-4">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-gray-900 font-semibold">Lv.{game.level} {levelTitle(game.level)}</span>
              <span className="text-violet-600">{Math.round((game.xp / xpForLevel(game.level)) * 100)}%</span>
            </div>
            <XpBar />
          </div>

          {/* 틀린 문제 */}
          {wrongOnes.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 mb-4">
              <div className="text-xs font-bold text-red-600 mb-2">❌ 틀린 {wrongOnes.length}문제 → 오답 노트에 저장됨</div>
              {wrongOnes.map((w, i) => (
                <div key={i} className="bg-gray-100 rounded-lg p-2.5 mb-1.5">
                  <p className="text-xs text-gray-400 line-clamp-1">{w.question}</p>
                  <div className="flex gap-2 text-xs mt-1">
                    <span className="text-red-600">내 답: {w.studentAnswer}번</span>
                    <span className="text-green-600">정답: {w.correctAnswer}번</span>
                  </div>
                </div>
              ))}
              <p className="text-xs text-gray-500 mt-1.5">내일 약점 특훈에서 다시 만나요!</p>
            </div>
          )}

          {/* CTA */}
          <div className="space-y-2.5">
            {wrongOnes.length > 0 && <button onClick={() => { setCurrentIndex(0); setSelectedAnswer(null); setShowExplanation(false); setScore({correct:0,total:0}); setQuizAnswers([]); setConsecutiveCorrect(0); setMode('quiz'); }}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-600 to-yellow-500 text-black font-bold text-sm">⚡ 같은 문제 다시 풀기</button>}
            <button onClick={goScan} className="w-full py-3 rounded-xl bg-gradient-to-r from-violet-600 to-violet-500 text-white font-medium">📷 새 시험지 스캔</button>
            <button onClick={resetAll} className="w-full py-3 rounded-xl bg-violet-50 border border-violet-200 text-violet-600 font-medium">🏠 홈으로</button>
          </div>
        </div>
        <BottomNav />
        <LevelUpModal />
      </div>
    );
  }

  // ═══════════════════════════════════════
  // 퀘스트 탭
  // ═══════════════════════════════════════
  if (mode === 'quest') return (
    <div className="min-h-screen bg-gradient-to-b from-violet-50 to-white pb-20">
      <div className="max-w-xl mx-auto px-4 py-6">
        <h1 className="text-xl font-bold text-gray-900 text-center mb-5">🎮 퀘스트</h1>
        <div className="bg-white shadow-sm border border-violet-200 rounded-2xl p-4 mb-4">
          <div className="text-xs font-bold text-violet-600 mb-3">📋 일일 미션</div>
          {[
            { text: '문제 3개 풀기', target: 3, current: game.totalSolved, qp: 30 },
            { text: '새 시험지 스캔', target: 1, current: 0, qp: 50 },
            { text: '오답 특훈 1회', target: 1, current: 0, qp: 40 },
          ].map((m, i) => (
            <div key={i} className="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0">
              <span className="text-sm">{Math.min(m.current, m.target) >= m.target ? '✅' : '📝'}</span>
              <div className="flex-1">
                <div className={`text-xs ${m.current >= m.target ? 'text-gray-500 line-through' : 'text-gray-900'}`}>{m.text}</div>
                <div className="h-1 bg-gray-100 rounded-full mt-1 overflow-hidden"><div className="h-full bg-violet-500 rounded-full" style={{ width: `${Math.min((m.current / m.target) * 100, 100)}%` }} /></div>
              </div>
              <span className="text-xs text-yellow-600 font-semibold">+{m.qp} QP</span>
            </div>
          ))}
        </div>
        <div className="bg-white shadow-sm border border-gray-100 rounded-2xl p-4 opacity-50">
          <div className="text-xs font-bold text-yellow-600 mb-2">🏆 주간 챌린지</div>
          <p className="text-xs text-gray-500">Lv.5 달성 시 해금됩니다</p>
        </div>
      </div>
      <BottomNav />
    </div>
  );

  // ═══════════════════════════════════════
  // 프로필
  // ═══════════════════════════════════════
  if (mode === 'profile') return (
    <div className="min-h-screen bg-gradient-to-b from-violet-50 to-white pb-20">
      <div className="max-w-xl mx-auto px-4 py-6">
        <div className="text-center mb-5">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-600 to-violet-400 flex items-center justify-center text-3xl mx-auto mb-2 border-3 border-yellow-400/50">🧠</div>
          <h2 className="text-lg font-extrabold text-gray-900">Lv.{game.level} {levelTitle(game.level)}</h2>
          <XpBar />
        </div>
        <div className="grid grid-cols-3 gap-2 mb-4">
          {[
            { v: game.totalSolved, l: '총 문제', c: 'text-gray-900' },
            { v: game.qp, l: 'QP', c: 'text-yellow-600' },
            { v: `${game.streak}일`, l: '🔥 연속', c: 'text-red-600' },
          ].map((s, i) => (
            <div key={i} className="bg-white shadow-sm rounded-xl p-3 text-center">
              <div className={`text-base font-extrabold ${s.c}`}>{s.v}</div>
              <div className="text-xs text-gray-500">{s.l}</div>
            </div>
          ))}
        </div>
        {game.categories.length > 0 && (
          <div className="bg-white shadow-sm border border-gray-100 rounded-2xl p-4 mb-4">
            <div className="text-xs font-bold text-gray-900 mb-2">🏷 내 카테고리</div>
            <div className="flex gap-1.5 flex-wrap">{game.categories.map(c => <span key={c} className="px-2.5 py-1 bg-violet-100 text-violet-600 text-xs rounded-lg">{c}</span>)}</div>
          </div>
        )}
        <div className="bg-white shadow-sm border border-gray-100 rounded-2xl p-4 mb-4">
          <div className="text-xs font-bold text-gray-900 mb-2">🏅 뱃지</div>
          <div className="flex gap-2">
            {[1,2,3,4].map(i => <div key={i} className="w-10 h-10 rounded-xl bg-gray-100 border border-dashed border-gray-200 flex items-center justify-center text-sm text-gray-600">🔒</div>)}
          </div>
          <p className="text-xs text-gray-500 mt-2">과목별 정답률 80% + 20문제 이상 풀면 뱃지 획득!</p>
        </div>

        {/* 계정 정보 + 로그아웃 */}
        <div className="bg-white shadow-sm border border-gray-100 rounded-2xl p-4">
          <div className="text-xs font-bold text-gray-900 mb-2">👤 계정</div>
          <p className="text-xs text-gray-500 mb-3">{user?.email || user?.user_metadata?.full_name || '로그인됨'}</p>
          <button
            onClick={async () => { await signOut(); setUser(null); setMode('login'); }}
            className="w-full py-2.5 rounded-xl border border-red-200 text-red-500 text-xs font-medium hover:bg-red-50 transition-colors"
          >
            로그아웃
          </button>
        </div>
      </div>
      <BottomNav />
    </div>
  );

  return null;
}

