'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

// ─── 타입 ───
interface ParsedProblem {
  question_text: string;
  choices: string[];
  marked_answer: string | null;
  correct_answer: string | null;
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
  // 화면 모드
  const [mode, setMode] = useState<
    'loading' | 'onboard1' | 'onboard2' | 'onboard3' | 'choice' |
    'home' | 'scan' | 'parsed' | 'quiz' | 'result' | 'quest' | 'profile'
  >('loading');
  const [tab, setTab] = useState<'photo' | 'unit'>('photo');
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

  // ─── 초기화 ───
  useEffect(() => {
    const g = loadGame();
    setGame(g);
    // 스트릭 체크
    const today = new Date().toISOString().slice(0, 10);
    if (g.lastPlayDate && g.lastPlayDate !== today) {
      const last = new Date(g.lastPlayDate);
      const diff = Math.floor((new Date(today).getTime() - last.getTime()) / 86400000);
      if (diff > 1) { g.streak = 0; saveGame(g); setGame({ ...g }); }
    }
    // 온보딩 완료 여부
    setMode(g.onboardDone ? 'home' : 'onboard1');
  }, []);

  useEffect(() => {
    fetch('/api/units').then(r => r.json()).then(d => setUnits(d.units || [])).catch(() => {});
  }, []);

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
      setSelectedParsedIdx(data.problems.map((_: ParsedProblem, i: number) => i));
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
      const allProblems: QuizProblem[] = [];
      for (const idx of selectedParsedIdx) {
        const original = parseResult.problems[idx];
        const res = await fetch('/api/generate-similar', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ originalProblem: original, count: Math.max(1, Math.floor(count / selectedParsedIdx.length)), difficulty }),
        });
        const data = await res.json();
        if (data.problems) allProblems.push(...data.problems);
      }
      if (allProblems.length > 0) {
        setProblems(allProblems.slice(0, count));
        setCurrentIndex(0); setSelectedAnswer(null); setShowExplanation(false);
        setScore({ correct: 0, total: 0 }); setQuizAnswers([]); setConsecutiveCorrect(0);
        setMode('quiz');
      }
    } catch { alert('문제 생성에 실패했습니다.'); }
    finally { setLoading(false); }
  };

  // ─── 단원 기반 생성 ───
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
        body: JSON.stringify({ question_text: problem.question_text, choices: problem.choices, correct_answer: problem.correct_answer, student_answer: answer, is_correct: isCorrect, subject: problem.subject || null, topic: problem.topic || null, keywords: problem.keywords || [] }),
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
    <div className="fixed bottom-0 left-0 right-0 h-16 bg-gray-950/95 backdrop-blur-lg border-t border-white/5 flex items-center justify-around z-50">
      {[
        { id: 'home' as const, icon: '🏠', label: '홈', action: () => { setMode('home'); setActiveNav('home'); } },
        { id: 'scan' as const, icon: '📷', label: '스캔', action: goScan },
        { id: 'quest' as const, icon: '🎮', label: '퀘스트', action: () => { setMode('quest'); setActiveNav('quest'); } },
        { id: 'analysis' as const, icon: '📊', label: '분석', action: () => {} },
        { id: 'profile' as const, icon: '👤', label: '내 정보', action: () => { setMode('profile'); setActiveNav('profile'); } },
      ].map(n => (
        <button key={n.id} onClick={n.action} className={`flex flex-col items-center gap-0.5 text-[10px] px-3 py-1 transition-colors ${activeNav === n.id ? 'text-violet-400' : 'text-gray-600'} ${n.id === 'analysis' ? 'opacity-30' : ''}`}>
          <span className="text-lg">{n.icon}</span>
          <span>{n.label}{n.id === 'analysis' ? ' 🔒' : ''}</span>
        </button>
      ))}
    </div>
  );

  // ─── 레벨업 모달 ───
  const LevelUpModal = () => showLevelUp ? (
    <div className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center animate-fade-in">
      <div className="bg-gray-900 border border-violet-500/30 rounded-3xl p-8 text-center mx-6 animate-bounce-in">
        <div className="text-5xl mb-3">🎊</div>
        <h2 className="text-2xl font-bold text-white mb-1">레벨 업!</h2>
        <p className="text-violet-400 text-lg font-bold">Lv.{game.level - 1} → Lv.{game.level}</p>
        <p className="text-gray-500 text-sm mt-2">{levelTitle(game.level)}</p>
        <button onClick={() => setShowLevelUp(false)} className="mt-4 px-6 py-2 bg-violet-600 text-white rounded-xl text-sm font-medium">확인</button>
      </div>
    </div>
  ) : null;

  // ─── XP 바 ───
  const XpBar = ({ compact = false }: { compact?: boolean }) => (
    <div className={compact ? 'flex items-center gap-2' : ''}>
      <div className={`flex justify-between text-[10px] mb-1 ${compact ? 'hidden' : ''}`}>
        <span className="text-gray-500">Lv.{game.level} {levelTitle(game.level)}</span>
        <span className="text-violet-400">{game.xp}/{xpForLevel(game.level)}</span>
      </div>
      <div className={`bg-white/5 rounded-full overflow-hidden ${compact ? 'flex-1 h-1.5' : 'h-2'}`}>
        <div className="h-full bg-gradient-to-r from-violet-600 to-violet-400 rounded-full transition-all" style={{ width: `${(game.xp / xpForLevel(game.level)) * 100}%` }} />
      </div>
    </div>
  );

  // ═══════════════════════════════════════
  // 로딩
  // ═══════════════════════════════════════
  if (mode === 'loading') return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-black text-white">Q<span className="text-violet-400">T</span></h1>
        <p className="text-gray-600 text-sm mt-2">틀린 문제가 경험치가 되는 곳</p>
      </div>
    </div>
  );

  // ═══════════════════════════════════════
  // 온보딩 1: 핵심 가치
  // ═══════════════════════════════════════
  if (mode === 'onboard1') return (
    <div className="min-h-screen bg-gray-950 flex flex-col px-7 py-14">
      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="text-6xl mb-2">📸</div>
        <div className="text-3xl mt-1">→ 🧠 → ✍️</div>
      </div>
      <div className="text-center mb-8">
        <h2 className="text-xl font-extrabold text-white leading-relaxed">찍으면, AI가 분석하고<br/>새 문제를 만들어줘요</h2>
        <p className="text-sm text-gray-500 mt-3">시험지든 워크북이든, 과목 상관없이<br/><span className="text-violet-400 font-semibold">사진 한 장</span>이면 충분해요</p>
      </div>
      <div className="flex gap-2 justify-center mb-5">
        <div className="w-6 h-2 rounded-full bg-violet-500" /><div className="w-2 h-2 rounded-full bg-white/10" /><div className="w-2 h-2 rounded-full bg-white/10" />
      </div>
      <button onClick={() => setMode('onboard2')} className="w-full py-4 rounded-2xl bg-gradient-to-r from-violet-600 to-violet-500 text-white font-bold text-base">다음</button>
      <button onClick={() => { setGame(prev => { const g = { ...prev, onboardDone: true }; saveGame(g); return g; }); setMode('home'); }} className="text-gray-600 text-sm text-center mt-3 py-2">건너뛰기</button>
    </div>
  );

  // ═══════════════════════════════════════
  // 온보딩 2: 자동 개인화
  // ═══════════════════════════════════════
  if (mode === 'onboard2') return (
    <div className="min-h-screen bg-gray-950 flex flex-col px-7 py-14">
      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="text-6xl mb-4">🎯</div>
        <div className="flex gap-2 flex-wrap justify-center">
          <span className="px-3 py-1.5 rounded-lg text-xs bg-red-500/15 text-red-400">수학 42%</span>
          <span className="px-3 py-1.5 rounded-lg text-xs bg-yellow-500/15 text-yellow-400">과학 71%</span>
          <span className="px-3 py-1.5 rounded-lg text-xs bg-green-500/15 text-green-400">영어 88%</span>
        </div>
      </div>
      <div className="text-center mb-8">
        <h2 className="text-xl font-extrabold text-white leading-relaxed">풀수록 나를 알아가요</h2>
        <p className="text-sm text-gray-500 mt-3">어떤 문제를 풀었는지, 뭘 틀렸는지<br/>AI가 자동으로 <span className="text-violet-400 font-semibold">약점 맵</span>을 만들어요</p>
      </div>
      <div className="flex gap-2 justify-center mb-5">
        <div className="w-2 h-2 rounded-full bg-white/10" /><div className="w-6 h-2 rounded-full bg-violet-500" /><div className="w-2 h-2 rounded-full bg-white/10" />
      </div>
      <button onClick={() => setMode('onboard3')} className="w-full py-4 rounded-2xl bg-gradient-to-r from-violet-600 to-violet-500 text-white font-bold text-base">다음</button>
      <button onClick={() => { setGame(prev => { const g = { ...prev, onboardDone: true }; saveGame(g); return g; }); setMode('home'); }} className="text-gray-600 text-sm text-center mt-3 py-2">건너뛰기</button>
    </div>
  );

  // ═══════════════════════════════════════
  // 온보딩 3: 게이미피케이션 티저
  // ═══════════════════════════════════════
  if (mode === 'onboard3') return (
    <div className="min-h-screen bg-gray-950 flex flex-col px-7 py-14">
      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="text-5xl mb-4">🏆</div>
        <div className="flex gap-2 flex-wrap justify-center">
          {[
            { icon: '⭐', label: 'XP & 레벨', bg: 'bg-violet-500/10', border: 'border-violet-500/20', text: 'text-violet-400' },
            { icon: '🏅', label: '뱃지 수집', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20', text: 'text-yellow-400' },
            { icon: '🔥', label: '연속 기록', bg: 'bg-red-500/10', border: 'border-red-500/20', text: 'text-red-400' },
            { icon: '⚔️', label: '랭킹 경쟁', bg: 'bg-blue-500/10', border: 'border-blue-500/20', text: 'text-blue-400' },
          ].map(({ icon, label, bg, border, text }) => (
            <div key={label} className={`${bg} border ${border} rounded-xl px-3 py-2 text-center`}>
              <div className="text-xl">{icon}</div>
              <div className={`text-[9px] ${text}`}>{label}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="text-center mb-8">
        <h2 className="text-xl font-extrabold text-white leading-relaxed">공부가 게임이 되는 순간</h2>
        <p className="text-sm text-gray-500 mt-3">경험치, 뱃지, 랭킹, 시즌 챌린지<br/><span className="text-yellow-400 font-semibold">풀수록 해금되는 것들</span>이 기다리고 있어요</p>
      </div>
      <div className="flex gap-2 justify-center mb-5">
        <div className="w-2 h-2 rounded-full bg-white/10" /><div className="w-2 h-2 rounded-full bg-white/10" /><div className="w-6 h-2 rounded-full bg-violet-500" />
      </div>
      <button onClick={() => setMode('choice')} className="w-full py-4 rounded-2xl bg-gradient-to-r from-violet-600 to-violet-500 text-white font-bold text-base">시작하기</button>
    </div>
  );

  // ═══════════════════════════════════════
  // 첫 액션 선택
  // ═══════════════════════════════════════
  if (mode === 'choice') return (
    <div className="min-h-screen bg-gray-950 px-6 py-14">
      <div className="text-center mb-6">
        <div className="text-3xl mb-2">👋</div>
        <h2 className="text-lg font-extrabold text-white">어떻게 시작할까요?</h2>
        <p className="text-xs text-gray-500 mt-1">어떤 걸 선택해도 좋아요</p>
      </div>
      <div onClick={() => { completeOnboard(); goScan(); }} className="bg-white/[0.03] border-2 border-violet-500/30 rounded-2xl p-5 mb-3 cursor-pointer active:scale-[0.98] transition-transform relative">
        <div className="absolute top-3 right-3 bg-violet-600 text-white text-[10px] font-bold px-2.5 py-0.5 rounded">추천</div>
        <div className="text-3xl mb-2">📸</div>
        <h3 className="text-base font-bold text-white mb-1">시험지 바로 찍기</h3>
        <p className="text-xs text-gray-500 leading-relaxed">가지고 있는 시험지나 문제집을 바로 찍어보세요.<br/>AI가 과목과 유형을 자동으로 파악해요.</p>
        <div className="text-xs text-yellow-400 font-semibold mt-2">🎁 첫 스캔 보너스 +100 QP</div>
      </div>
      <div onClick={completeOnboard} className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5 cursor-pointer active:scale-[0.98] transition-transform">
        <div className="text-3xl mb-2">🏠</div>
        <h3 className="text-base font-bold text-white mb-1">홈에서 둘러보기</h3>
        <p className="text-xs text-gray-500 leading-relaxed">먼저 둘러보고, 준비되면 스캔해요.</p>
      </div>
      <p className="text-[10px] text-gray-600 text-center mt-6">📷 촬영한 사진은 문제 분석에만 사용되며, 서버에 저장되지 않습니다.</p>
    </div>
  );

  // ═══════════════════════════════════════
  // 홈 허브
  // ═══════════════════════════════════════
  if (mode === 'home') return (
    <div className="min-h-screen bg-gray-950 pb-20">
      <div className="max-w-xl mx-auto px-4 pt-6">
        {/* 프로필 바 */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-11 h-11 rounded-full bg-gradient-to-br from-violet-600 to-violet-400 flex items-center justify-center text-xl border-2 border-violet-400/50">🧠</div>
          <div className="flex-1">
            <div className="text-sm font-bold text-white">Lv.{game.level} {levelTitle(game.level)}</div>
            <XpBar />
          </div>
          <div className="text-center">
            <div className="text-lg">🔥</div>
            <div className="text-[10px] text-yellow-400 font-bold">{game.streak}일</div>
          </div>
        </div>

        {/* QP / 통계 */}
        <div className="flex gap-2 mb-4">
          <div className="flex-1 bg-yellow-500/[0.08] border border-yellow-500/20 rounded-xl px-3 py-2 text-center">
            <div className="text-[9px] text-yellow-400">QP</div>
            <div className="text-base font-extrabold text-yellow-400">{game.qp}</div>
          </div>
          <div className="flex-1 bg-green-500/[0.08] border border-green-500/20 rounded-xl px-3 py-2 text-center">
            <div className="text-[9px] text-green-400">푼 문제</div>
            <div className="text-base font-extrabold text-green-400">{game.totalSolved}</div>
          </div>
          <div className="flex-1 bg-violet-500/[0.08] border border-violet-500/20 rounded-xl px-3 py-2 text-center">
            <div className="text-[9px] text-violet-400">정답률</div>
            <div className="text-base font-extrabold text-violet-400">{game.totalSolved > 0 ? Math.round((game.totalCorrect / game.totalSolved) * 100) : 0}%</div>
          </div>
        </div>

        {/* 일일 미션 */}
        <div className="bg-white/[0.03] border border-violet-500/20 rounded-2xl p-4 mb-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-bold text-violet-400">📋 오늘의 미션</span>
            <span className="text-[10px] text-gray-500">{Math.min(game.totalSolved >= 3 ? 1 : 0, 1) + (game.totalSolved >= 1 ? 1 : 0)}/3</span>
          </div>
          <div className="space-y-1.5 text-[11px]">
            <div className="flex justify-between"><span className={game.totalSolved >= 3 ? 'text-gray-500 line-through' : 'text-gray-300'}>{game.totalSolved >= 3 ? '✅' : '⬜'} 문제 3개 풀기</span><span className="text-violet-400">+30 QP</span></div>
            <div className="flex justify-between"><span className="text-gray-300">⬜ 새 시험지 스캔</span><span className="text-violet-400">+50 QP</span></div>
            <div className="flex justify-between"><span className="text-gray-300">⬜ 오답 특훈 1회</span><span className="text-violet-400">+40 QP</span></div>
          </div>
        </div>

        {/* CTA */}
        <button onClick={goScan} className="w-full py-4 rounded-2xl bg-gradient-to-r from-violet-600 to-violet-500 text-white font-bold text-[15px] mb-4">📷 시험지 스캔하기</button>

        {/* 카테고리 */}
        {game.categories.length > 0 && (
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 mb-4">
            <div className="text-xs font-bold text-white mb-2">🏷 내 카테고리</div>
            <div className="flex gap-1.5 flex-wrap">
              {game.categories.map(c => <span key={c} className="px-2.5 py-1 bg-violet-500/15 text-violet-400 text-[10px] rounded-lg font-medium">{c}</span>)}
            </div>
          </div>
        )}

        {/* 해금 프리뷰 */}
        <div className="bg-white/[0.02] border border-white/[0.05] rounded-2xl p-4 opacity-60">
          <div className="text-xs font-bold text-white mb-2">🔒 해금 대기 중</div>
          <div className="space-y-1 text-[11px] text-gray-500">
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
    <div className="min-h-screen bg-gray-950 pb-20">
      <div className="max-w-xl mx-auto px-4 py-6">
        <div className="text-center mb-5">
          <h1 className="text-xl font-bold text-white">📷 시험지 스캔</h1>
          <p className="text-xs text-gray-500 mt-1">틀린 문제를 찍으면 AI가 분석해줘요</p>
        </div>

        {/* 탭 */}
        <div className="flex bg-white/5 rounded-xl p-1 mb-4">
          <button onClick={() => setTab('photo')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'photo' ? 'bg-violet-600 text-white' : 'text-gray-500'}`}>📷 사진으로 풀기</button>
          <button onClick={() => setTab('unit')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'unit' ? 'bg-violet-600 text-white' : 'text-gray-500'}`}>📚 단원 선택</button>
        </div>

        {/* 사진 탭 */}
        {tab === 'photo' && (
          <>
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5 mb-4">
              <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={handleImageSelect} className="hidden" />
              {imagePreview ? (
                <div className="relative mb-3">
                  <img src={imagePreview} alt="업로드된 문제" className="w-full rounded-xl border border-white/10 max-h-72 object-contain bg-black/20" />
                  <button onClick={() => { setImageFile(null); setImagePreview(null); setParseResult(null); }} className="absolute top-2 right-2 w-7 h-7 bg-black/50 text-white rounded-full flex items-center justify-center text-xs">✕</button>
                </div>
              ) : (
                <button onClick={() => fileInputRef.current?.click()} className="w-full h-44 border-2 border-dashed border-violet-500/30 rounded-xl flex flex-col items-center justify-center gap-2 text-violet-400/70 hover:border-violet-400 transition-colors mb-3">
                  <span className="text-4xl">📸</span>
                  <span className="text-sm font-medium">사진 찍기 / 이미지 선택</span>
                </button>
              )}

              {/* 촬영 가이드 */}
              <div className="bg-white/[0.03] rounded-xl p-3 text-[11px] text-gray-400 space-y-1 mb-3">
                <div className="text-xs font-bold text-white mb-1.5">💡 잘 찍는 법</div>
                <div>✅ 문제 전체가 보이게 찍어주세요</div>
                <div>✅ 밝은 곳에서, 그림자 없이</div>
                <div>✅ 살짝 기울어져도 AI가 읽어요</div>
                <div>✅ 한 장에 여러 문제 OK — 과목 상관없이!</div>
              </div>

              {imageFile && !parsing && (
                <button onClick={handleParseImage} className="w-full py-3 rounded-xl bg-gradient-to-r from-violet-600 to-violet-500 text-white font-medium">문제 분석하기</button>
              )}
              {parsing && (
                <div className="w-full py-3 rounded-xl bg-violet-900/30 text-violet-300 font-medium text-center text-sm">
                  <span className="inline-block animate-spin mr-2">⏳</span>AI가 문제를 분석하고 있어요...
                </div>
              )}
            </div>

            {game.totalSolved === 0 && (
              <div className="bg-yellow-500/[0.08] border border-yellow-500/20 rounded-xl p-3 text-center">
                <span className="text-xs text-yellow-400 font-semibold">🏆 첫 스캔 보너스! +100 QP</span>
              </div>
            )}

            <p className="text-[9px] text-gray-600 text-center mt-3">📷 촬영한 사진은 분석 후 즉시 삭제됩니다</p>
          </>
        )}

        {/* 단원 탭 */}
        {tab === 'unit' && (
          <>
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5 mb-4">
              <h2 className="text-sm font-semibold text-white mb-1">단원 선택</h2>
              <p className="text-[10px] text-gray-500 mb-3">중2 과학 · 천재교과서</p>
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {units.map(l1 => (
                  <details key={l1.id} className="group">
                    <summary className="cursor-pointer py-1.5 px-3 rounded-lg hover:bg-white/5 font-medium text-gray-300 text-xs">{l1.code}. {l1.title}</summary>
                    <div className="ml-3 mt-1 space-y-0.5">
                      {l1.children?.map(l2 => (
                        <details key={l2.id}>
                          <summary className="cursor-pointer py-1 px-3 rounded text-[11px] text-gray-400 hover:bg-white/5">{l2.code}. {l2.title}</summary>
                          <div className="ml-3 mt-0.5 space-y-0.5">
                            {l2.children?.map(l3 => (
                              <button key={l3.id} onClick={() => { setSelectedUnit(l3.id); setSelectedUnitName(`${l3.code} ${l3.title}`); }}
                                className={`w-full text-left py-1 px-3 rounded text-[11px] transition-colors ${selectedUnit === l3.id ? 'bg-violet-500/20 text-violet-300 font-medium' : 'text-gray-500 hover:bg-white/5'}`}>
                                {l3.code}. {l3.title}
                              </button>
                            ))}
                          </div>
                        </details>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
              {selectedUnit && <div className="mt-2 text-[11px] text-violet-400 bg-violet-500/10 px-3 py-1.5 rounded-lg">선택: {selectedUnitName}</div>}
            </div>
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5 mb-4">
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="text-[10px] font-medium text-gray-400 mb-1.5 block">난이도</label>
                  <div className="flex gap-1.5">{[1,2,3].map(d => <button key={d} onClick={() => setDifficulty(d)} className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${difficulty === d ? 'bg-violet-600 text-white' : 'bg-white/5 text-gray-500'}`}>{diffLabels[d]}</button>)}</div>
                </div>
                <div className="flex-1">
                  <label className="text-[10px] font-medium text-gray-400 mb-1.5 block">문제 수</label>
                  <select value={count} onChange={e => setCount(Number(e.target.value))} className="w-full py-1.5 px-2 rounded-lg border border-white/10 bg-white/5 text-sm text-white">{[3,5,10].map(n => <option key={n} value={n}>{n}문제</option>)}</select>
                </div>
              </div>
            </div>
            <button onClick={generateFromUnit} disabled={!selectedUnit || loading} className="w-full py-4 rounded-2xl bg-gradient-to-r from-violet-600 to-violet-500 text-white font-bold disabled:bg-gray-700 disabled:text-gray-500 transition-colors">
              {loading ? '문제 생성 중...' : '문제 풀기 시작'}
            </button>
          </>
        )}
      </div>
      <BottomNav />
    </div>
  );

  // ═══════════════════════════════════════
  // 파싱 결과 (촬영 후 안내)
  // ═══════════════════════════════════════
  if (mode === 'parsed' && parseResult) return (
    <div className="min-h-screen bg-gray-950 pb-20">
      <div className="max-w-xl mx-auto px-4 py-6">
        <button onClick={goScan} className="text-violet-400 text-sm mb-3 flex items-center gap-1">← 다시 촬영</button>

        <div className="text-center mb-5">
          <div className="text-3xl mb-1">🎯</div>
          <h2 className="text-lg font-extrabold text-white">{parseResult.problems.length}문제 발견!</h2>
          <p className="text-xs text-gray-500">{parseResult.overall_subject} · {parseResult.source_description}</p>
        </div>

        {/* 촬영 후 안내 */}
        <div className="bg-green-500/[0.08] border border-green-500/20 rounded-xl p-3 mb-4">
          <p className="text-[11px] text-green-400 leading-relaxed">✨ <strong>선택한 문제를 기반으로</strong> AI가 같은 개념, 다른 숫자의 유사 문제를 만들어요. 진짜 이해했는지 확인!</p>
        </div>

        {/* 문제 목록 */}
        <div className="space-y-2 mb-4">
          {parseResult.problems.map((p, idx) => (
            <div key={idx} onClick={() => setSelectedParsedIdx(prev => prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx])}
              className={`bg-white/[0.03] rounded-xl p-3 border-2 cursor-pointer transition-colors ${selectedParsedIdx.includes(idx) ? 'border-violet-500/50' : 'border-transparent'}`}>
              <div className="flex items-start gap-2">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${selectedParsedIdx.includes(idx) ? 'bg-violet-600 text-white' : 'bg-white/10 text-gray-500'}`}>{idx + 1}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-300 leading-relaxed line-clamp-2">{p.question_text}</p>
                  <div className="flex gap-1 mt-1.5 flex-wrap">
                    <span className="px-1.5 py-0.5 bg-violet-500/15 text-violet-400 text-[9px] rounded">{p.subject}</span>
                    <span className="px-1.5 py-0.5 bg-white/5 text-gray-400 text-[9px] rounded">{p.topic}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* 옵션 + 예상 보상 */}
        <div className="flex gap-2 mb-4">
          <div className="flex-1 bg-white/[0.03] rounded-xl p-2.5 text-center">
            <div className="text-[9px] text-gray-500">문제 수</div>
            <select value={count} onChange={e => setCount(Number(e.target.value))} className="text-sm font-bold text-white bg-transparent text-center">{[3,5,10].map(n => <option key={n} value={n}>{n}</option>)}</select>
          </div>
          <div className="flex-1 bg-white/[0.03] rounded-xl p-2.5 text-center">
            <div className="text-[9px] text-gray-500">난이도</div>
            <div className="flex gap-1 mt-1 justify-center">{[1,2,3].map(d => <button key={d} onClick={() => setDifficulty(d)} className={`px-2 py-0.5 rounded text-[10px] font-medium ${difficulty === d ? 'bg-violet-600 text-white' : 'bg-white/5 text-gray-500'}`}>{d===1?'쉽게':d===2?'비슷':'어렵게'}</button>)}</div>
          </div>
          <div className="flex-1 bg-yellow-500/[0.08] rounded-xl p-2.5 text-center">
            <div className="text-[9px] text-yellow-400">예상 보상</div>
            <div className="text-sm font-bold text-yellow-400">+{count * 15} QP</div>
          </div>
        </div>

        <button onClick={generateSimilar} disabled={selectedParsedIdx.length === 0 || loading}
          className="w-full py-4 rounded-2xl bg-gradient-to-r from-violet-600 to-violet-500 text-white font-bold disabled:bg-gray-700 disabled:text-gray-500 transition-colors">
          {loading ? <span><span className="inline-block animate-spin mr-2">⏳</span>유사 문제 생성 중...</span> : `⚡ ${selectedParsedIdx.length}문제로 연습 시작`}
        </button>
      </div>
      <BottomNav />
    </div>
  );

  // ═══════════════════════════════════════
  // 퀴즈 화면
  // ═══════════════════════════════════════
  if (mode === 'quiz' && problems.length > 0) {
    const problem = problems[currentIndex];
    return (
      <div className="min-h-screen bg-gray-950">
        <div className="max-w-xl mx-auto px-4 py-6">
          {/* 진행바 + 스트릭 */}
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs text-gray-500">{currentIndex + 1}/{problems.length}</span>
            <div className="flex-1 mx-3 h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-violet-600 to-violet-400 rounded-full transition-all" style={{ width: `${((currentIndex + 1) / problems.length) * 100}%` }} />
            </div>
            {consecutiveCorrect >= 2 && <span className="text-[11px] text-yellow-400 font-bold">🔥 {consecutiveCorrect}연속{consecutiveCorrect >= 5 ? '! x2.0' : consecutiveCorrect >= 3 ? ' x1.5' : ''}</span>}
            <span className="text-xs font-medium text-violet-400 ml-2">{score.correct}/{score.total}</span>
          </div>

          {/* 태그 */}
          <div className="flex gap-1.5 mb-3 flex-wrap">
            {problem.subject && <span className="px-2 py-0.5 bg-violet-500/15 text-violet-400 text-[10px] rounded font-medium">{problem.subject}</span>}
            {problem.topic && <span className="px-2 py-0.5 bg-white/5 text-gray-400 text-[10px] rounded">{problem.topic}</span>}
            <span className="px-2 py-0.5 bg-yellow-500/15 text-yellow-400 text-[10px] rounded">{bloomLabels[problem.bloom_level] || '기타'}</span>
          </div>

          {/* 문제 카드 */}
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5 mb-4">
            <p className="text-sm font-medium text-white leading-relaxed whitespace-pre-wrap">{problem.question_text}</p>
          </div>

          {/* 선택지 */}
          <div className="space-y-2.5 mb-4">
            {problem.choices.map((choice, idx) => {
              const num = String(idx + 1);
              const isSelected = selectedAnswer === num;
              const isCorrect = num === problem.correct_answer;
              let cls = 'w-full text-left p-3.5 rounded-xl border-2 transition-all text-sm ';
              if (selectedAnswer === null) cls += 'border-white/[0.06] hover:border-violet-500/30 text-gray-300';
              else if (isCorrect) cls += 'border-green-500/50 bg-green-500/10 text-green-300';
              else if (isSelected && !isCorrect) cls += 'border-red-500/50 bg-red-500/10 text-red-300';
              else cls += 'border-white/[0.03] text-gray-600';
              return <button key={idx} onClick={() => handleAnswer(idx)} className={cls}>{choice}</button>;
            })}
          </div>

          {/* 해설 */}
          {showExplanation && (
            <>
              {/* 정답/오답 피드백 */}
              <div className={`rounded-xl p-4 mb-3 border ${selectedAnswer === problems[currentIndex].correct_answer ? 'bg-green-500/[0.08] border-green-500/20' : 'bg-red-500/[0.08] border-red-500/20'}`}>
                <div className="text-xs font-bold mb-1" style={{ color: selectedAnswer === problems[currentIndex].correct_answer ? '#34d399' : '#f87171' }}>
                  {selectedAnswer === problems[currentIndex].correct_answer
                    ? (consecutiveCorrect >= 3 ? '🔥 완벽해요! 연속 정답 보너스!' : '👏 정확해요!')
                    : '아깝다! 핵심 포인트를 확인해봐요'}
                </div>
              </div>
              <div className="bg-amber-500/[0.08] border border-amber-500/20 rounded-xl p-4 mb-4">
                <h3 className="font-semibold text-amber-300 text-xs mb-1.5">해설</h3>
                <p className="text-xs text-amber-200/80 leading-relaxed whitespace-pre-wrap">{problem.explanation}</p>
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
      <div className="min-h-screen bg-gray-950 pb-20">
        <div className="max-w-xl mx-auto px-4 py-8">
          {/* 점수 */}
          <div className="text-center mb-5">
            <div className="text-4xl mb-2">{emoji}</div>
            <h2 className="text-xl font-extrabold text-white">{score.correct}/{score.total}</h2>
            <p className="text-sm text-gray-500">정답률 {pct}%</p>
            <p className="text-xs text-violet-400 mt-1">{msg}</p>
          </div>

          {/* 보상 */}
          <div className="bg-yellow-500/[0.08] border border-yellow-500/20 rounded-2xl p-4 mb-4">
            <div className="text-xs font-bold text-yellow-400 mb-2">🎁 획득한 보상</div>
            <div className="flex gap-2">
              <div className="flex-1 text-center bg-black/20 rounded-xl py-2.5"><div className="text-lg">⭐</div><div className="text-[10px] text-yellow-400">+{earnedXp} XP</div></div>
              <div className="flex-1 text-center bg-black/20 rounded-xl py-2.5"><div className="text-lg">💰</div><div className="text-[10px] text-yellow-400">+{earnedQp} QP</div></div>
              <div className="flex-1 text-center bg-black/20 rounded-xl py-2.5"><div className="text-lg">🔥</div><div className="text-[10px] text-yellow-400">{game.streak}일 연속</div></div>
            </div>
          </div>

          {/* 레벨 진행 */}
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 mb-4">
            <div className="flex justify-between text-[11px] mb-1">
              <span className="text-white font-semibold">Lv.{game.level} {levelTitle(game.level)}</span>
              <span className="text-violet-400">{Math.round((game.xp / xpForLevel(game.level)) * 100)}%</span>
            </div>
            <XpBar />
          </div>

          {/* 틀린 문제 */}
          {wrongOnes.length > 0 && (
            <div className="bg-red-500/[0.05] border border-red-500/15 rounded-2xl p-4 mb-4">
              <div className="text-xs font-bold text-red-400 mb-2">❌ 틀린 {wrongOnes.length}문제 → 오답 노트에 저장됨</div>
              {wrongOnes.map((w, i) => (
                <div key={i} className="bg-black/20 rounded-lg p-2.5 mb-1.5">
                  <p className="text-[10px] text-gray-400 line-clamp-1">{w.question}</p>
                  <div className="flex gap-2 text-[10px] mt-1">
                    <span className="text-red-400">내 답: {w.studentAnswer}번</span>
                    <span className="text-green-400">정답: {w.correctAnswer}번</span>
                  </div>
                </div>
              ))}
              <p className="text-[10px] text-gray-500 mt-1.5">내일 약점 특훈에서 다시 만나요!</p>
            </div>
          )}

          {/* CTA */}
          <div className="space-y-2.5">
            {wrongOnes.length > 0 && <button onClick={() => { setCurrentIndex(0); setSelectedAnswer(null); setShowExplanation(false); setScore({correct:0,total:0}); setQuizAnswers([]); setConsecutiveCorrect(0); setMode('quiz'); }}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-600 to-yellow-500 text-black font-bold text-sm">⚡ 같은 문제 다시 풀기</button>}
            <button onClick={goScan} className="w-full py-3 rounded-xl bg-gradient-to-r from-violet-600 to-violet-500 text-white font-medium">📷 새 시험지 스캔</button>
            <button onClick={resetAll} className="w-full py-3 rounded-xl bg-white/[0.05] text-violet-400 font-medium">🏠 홈으로</button>
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
    <div className="min-h-screen bg-gray-950 pb-20">
      <div className="max-w-xl mx-auto px-4 py-6">
        <h1 className="text-xl font-bold text-white text-center mb-5">🎮 퀘스트</h1>
        <div className="bg-white/[0.03] border border-violet-500/20 rounded-2xl p-4 mb-4">
          <div className="text-xs font-bold text-violet-400 mb-3">📋 일일 미션</div>
          {[
            { text: '문제 3개 풀기', target: 3, current: game.totalSolved, qp: 30 },
            { text: '새 시험지 스캔', target: 1, current: 0, qp: 50 },
            { text: '오답 특훈 1회', target: 1, current: 0, qp: 40 },
          ].map((m, i) => (
            <div key={i} className="flex items-center gap-3 py-2 border-b border-white/[0.04] last:border-0">
              <span className="text-sm">{Math.min(m.current, m.target) >= m.target ? '✅' : '📝'}</span>
              <div className="flex-1">
                <div className={`text-xs ${m.current >= m.target ? 'text-gray-500 line-through' : 'text-white'}`}>{m.text}</div>
                <div className="h-1 bg-white/5 rounded-full mt-1 overflow-hidden"><div className="h-full bg-violet-500 rounded-full" style={{ width: `${Math.min((m.current / m.target) * 100, 100)}%` }} /></div>
              </div>
              <span className="text-[10px] text-yellow-400 font-semibold">+{m.qp} QP</span>
            </div>
          ))}
        </div>
        <div className="bg-white/[0.02] border border-white/[0.05] rounded-2xl p-4 opacity-50">
          <div className="text-xs font-bold text-yellow-400 mb-2">🏆 주간 챌린지</div>
          <p className="text-[11px] text-gray-500">Lv.5 달성 시 해금됩니다</p>
        </div>
      </div>
      <BottomNav />
    </div>
  );

  // ═══════════════════════════════════════
  // 프로필
  // ═══════════════════════════════════════
  if (mode === 'profile') return (
    <div className="min-h-screen bg-gray-950 pb-20">
      <div className="max-w-xl mx-auto px-4 py-6">
        <div className="text-center mb-5">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-600 to-violet-400 flex items-center justify-center text-3xl mx-auto mb-2 border-3 border-yellow-400/50">🧠</div>
          <h2 className="text-lg font-extrabold text-white">Lv.{game.level} {levelTitle(game.level)}</h2>
          <XpBar />
        </div>
        <div className="grid grid-cols-3 gap-2 mb-4">
          {[
            { v: game.totalSolved, l: '총 문제', c: 'text-white' },
            { v: game.qp, l: 'QP', c: 'text-yellow-400' },
            { v: `${game.streak}일`, l: '🔥 연속', c: 'text-red-400' },
          ].map((s, i) => (
            <div key={i} className="bg-white/[0.03] rounded-xl p-3 text-center">
              <div className={`text-base font-extrabold ${s.c}`}>{s.v}</div>
              <div className="text-[9px] text-gray-500">{s.l}</div>
            </div>
          ))}
        </div>
        {game.categories.length > 0 && (
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 mb-4">
            <div className="text-xs font-bold text-white mb-2">🏷 내 카테고리</div>
            <div className="flex gap-1.5 flex-wrap">{game.categories.map(c => <span key={c} className="px-2.5 py-1 bg-violet-500/15 text-violet-400 text-[10px] rounded-lg">{c}</span>)}</div>
          </div>
        )}
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4">
          <div className="text-xs font-bold text-white mb-2">🏅 뱃지</div>
          <div className="flex gap-2">
            {[1,2,3,4].map(i => <div key={i} className="w-10 h-10 rounded-xl bg-white/5 border border-dashed border-white/10 flex items-center justify-center text-sm text-gray-600">🔒</div>)}
          </div>
          <p className="text-[10px] text-gray-500 mt-2">과목별 정답률 80% + 20문제 이상 풀면 뱃지 획득!</p>
        </div>
      </div>
      <BottomNav />
    </div>
  );

  return null;
}
