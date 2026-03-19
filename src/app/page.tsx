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
  id?: string;  // question_bank UUID (DB 저장 후)
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

interface BankCategory {
  [subject: string]: { [topic: string]: number };
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
  userKeywords: string[];
}

const DEFAULT_GAME: GameState = {
  xp: 0, level: 1, qp: 0, streak: 0,
  lastPlayDate: '', totalSolved: 0, totalCorrect: 0,
  onboardDone: false, categories: [], userKeywords: [],
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

// ─── 정답 번호 정규화 ───
// "①" → "1", "3번" → "3", "③" → "3" 등 다양한 포맷을 순수 숫자로 변환
function normalizeAnswer(raw: string | null | undefined): string {
  if (!raw) return '';
  const s = raw.toString().trim();
  // 원문자 ①②③④⑤ → 숫자
  const circled: Record<string, string> = { '①': '1', '②': '2', '③': '3', '④': '4', '⑤': '5' };
  if (circled[s]) return circled[s];
  // "3번", "3)" 등에서 숫자만 추출
  const m = s.match(/(\d+)/);
  return m ? m[1] : s;
}

// ─── 주관식 정답 비교 ───
// 공백, 전각/반각, ＜< 등을 정규화한 뒤 비교
function normalizeText(s: string): string {
  return s
    .replace(/\s+/g, '')       // 공백 제거
    .replace(/＜/g, '<').replace(/＞/g, '>') // 전각→반각
    .replace(/≤/g, '<=').replace(/≥/g, '>=')
    .replace(/[=＝]/g, '=')
    .toLowerCase();
}
function isShortAnswerCorrect(student: string, correct: string): boolean {
  // 정규화 후 완전 일치
  if (normalizeText(student) === normalizeText(correct)) return true;
  // 숫자만 추출 비교 (예: "a = -6" vs "-6")
  const sNums = student.match(/-?\d+\.?\d*/g);
  const cNums = correct.match(/-?\d+\.?\d*/g);
  if (sNums && cNums && sNums.join(',') === cNums.join(',')) return true;
  return false;
}

// ─── 수학 텍스트 렌더링 ───
// 수식 내 부등호를 유니코드 수학 기호로, 변수를 이탤릭으로 표시
function MathText({ text, className = '' }: { text: string; className?: string }) {
  // 1) ASCII 부등호 → 유니코드 수학 기호
  let processed = text
    .replace(/(<=[^>])/g, (m) => m) // 보호: HTML 아닌지 체크
    .replace(/>=|≥/g, '≥')
    .replace(/<=|≤/g, '≤')
    .replace(/(?<![<\w])>(?![>=\w])/g, '＞')
    .replace(/(?<![<\w])<(?![<=\w])/g, '＜');

  // 2) 수식 패턴 감지: 숫자, 연산자, 변수가 포함된 부분을 이탤릭 수학체로 감싸기
  // 단독 변수(x, y, a, b, k 등)를 이탤릭으로
  const parts = processed.split(/([a-zA-Z](?=[^a-zA-Z가-힣]|$))/g);

  const elements: React.ReactNode[] = [];
  let i = 0;
  while (i < parts.length) {
    const part = parts[i];
    // 단독 알파벳 변수 (1글자, 뒤에 한글이나 영문 단어가 아닌 경우)
    if (part && /^[a-zA-Z]$/.test(part)) {
      elements.push(<span key={i} style={{ fontStyle: 'italic', fontFamily: 'Georgia, "Times New Roman", serif' }}>{part}</span>);
    } else if (part) {
      elements.push(<span key={i}>{part}</span>);
    }
    i++;
  }

  return <span className={className}>{elements}</span>;
}

// ─── 메인 컴포넌트 ───
export default function Home() {
  // 화면 모드
  const [mode, setMode] = useState<
    'loading' | 'onboard1' | 'onboard2' | 'onboard3' | 'choice' |
    'home' | 'scan' | 'parsed' | 'preview' | 'quiz' | 'result' | 'quest' | 'bank' | 'profile'
  >('loading');
  const [tab, setTab] = useState<'photo' | 'keyword'>('photo');
  const [keywordInput, setKeywordInput] = useState('');
  // 홈 맵 키워드 씨앗
  const [keywordSeedInput, setKeywordSeedInput] = useState('');
  const [expandedKeywords, setExpandedKeywords] = useState<string[]>([]);
  const [expandingKeywords, setExpandingKeywords] = useState(false);
  const [activeNav, setActiveNav] = useState<'home' | 'scan' | 'quest' | 'profile'>('home');

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
  const fileInputRef = useRef<HTMLInputElement>(null);       // 카메라 촬영
  const galleryInputRef = useRef<HTMLInputElement>(null);    // 갤러리 선택

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
  const [textAnswer, setTextAnswer] = useState<string>(''); // 주관식 입력

  // 문제은행 상태
  const [bankProblems, setBankProblems] = useState<QuizProblem[]>([]);
  const [bankCategories, setBankCategories] = useState<BankCategory>({});
  const [bankTotal, setBankTotal] = useState(0);
  const [bankFilter, setBankFilter] = useState<{ subject?: string; topic?: string; keyword?: string }>({});
  const [bankLoading, setBankLoading] = useState(false);
  const [previewExpanded, setPreviewExpanded] = useState<number | null>(null);

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

  // ─── 이미지 압축 (Canvas 리사이즈) ───
  const compressImage = (file: File): Promise<File> => {
    return new Promise((resolve) => {
      const MAX_WIDTH = 1200;  // 문자 인식에 충분한 해상도
      const QUALITY = 0.75;
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        // 이미 작으면 압축 스킵
        if (img.width <= MAX_WIDTH && file.size < 500_000) {
          resolve(file);
          return;
        }
        const scale = Math.min(1, MAX_WIDTH / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            if (!blob) { resolve(file); return; }
            const compressed = new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' });
            resolve(compressed);
          },
          'image/jpeg', QUALITY
        );
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  };

  // ─── 사진 업로드 핸들러 ───
  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const compressed = await compressImage(file);
    setImageFile(compressed);
    setImagePreview(URL.createObjectURL(compressed));
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
        setPreviewExpanded(null);
        setMode('preview');
      }
    } catch { alert('문제 생성에 실패했습니다.'); }
    finally { setLoading(false); }
  };

  // ─── 키워드 기반 문제 검색 ───
  const generateFromKeyword = async (kw: string) => {
    if (!kw.trim()) return;
    setLoading(true);
    try {
      // 문제은행에서 해당 키워드 문제 검색
      const params = new URLSearchParams({ keyword: kw.trim(), limit: String(count) });
      const res = await fetch(`/api/question-bank?${params.toString()}`);
      const data = await res.json();
      if (data.problems && data.problems.length > 0) {
        setProblems(data.problems.slice(0, count));
        setCurrentIndex(0); setSelectedAnswer(null); setShowExplanation(false);
        setScore({ correct: 0, total: 0 }); setQuizAnswers([]); setConsecutiveCorrect(0);
        setPreviewExpanded(null);
        setMode('preview');
      } else {
        alert(`'${kw}' 키워드로 저장된 문제가 없어요.\n시험지를 스캔하면 자동으로 쌓여요!`);
      }
    } catch { console.error('키워드 검색 실패'); }
    finally { setLoading(false); }
  };

  // ─── 공통 채점 처리 ───
  const processAnswer = (answer: string, isCorrect: boolean) => {
    setSelectedAnswer(answer);
    setShowExplanation(true);

    const newConsecutive = isCorrect ? consecutiveCorrect + 1 : 0;
    setConsecutiveCorrect(newConsecutive);

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
      fetch('/api/save-result', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question_text: problem.question_text, choices: problem.choices, correct_answer: problem.correct_answer, student_answer: answer, is_correct: isCorrect, subject: problem.subject || null, topic: problem.topic || null, keywords: problem.keywords || [], question_bank_id: problem.id || null }),
      });
    } catch { /* ignore */ }
  };

  // ─── 객관식 답 선택 ───
  const handleAnswer = async (answerIdx: number) => {
    if (selectedAnswer !== null) return;
    const answer = String(answerIdx + 1);
    const isCorrect = answer === normalizeAnswer(problems[currentIndex].correct_answer);
    processAnswer(answer, isCorrect);
  };

  // ─── 주관식 답 제출 ───
  const handleTextSubmit = () => {
    if (selectedAnswer !== null || !textAnswer.trim()) return;
    const problem = problems[currentIndex];
    const isEssay = problem.question_type === 'essay';
    // 서술형은 자동 채점 불가 → 무조건 "확인" 처리 (정답 보여주기)
    const isCorrect = isEssay ? false : isShortAnswerCorrect(textAnswer.trim(), problem.correct_answer);
    processAnswer(textAnswer.trim(), isCorrect);
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
    setTextAnswer('');
  };

  // ─── 초기화 ───
  const resetAll = () => {
    setMode('home'); setActiveNav('home'); setProblems([]); setParseResult(null);
    setImageFile(null); setImagePreview(null); setSelectedParsedIdx([]);
    setSelectedUnit(''); setSelectedUnitName(''); setQuizAnswers([]); setTextAnswer('');
    setPreviewExpanded(null);
  };

  // ─── 키워드 확장 (홈 맵 씨앗) ───
  const expandKeywords = async (seed: string) => {
    if (!seed.trim()) return;
    setExpandingKeywords(true);
    try {
      const res = await fetch('/api/expand-keywords', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: seed.trim() }),
      });
      const data = await res.json();
      setExpandedKeywords(data.keywords || []);
    } catch { /* ignore */ }
    finally { setExpandingKeywords(false); }
  };

  // ─── 문제은행 불러오기 ───
  const loadBank = async (filter?: { subject?: string; topic?: string; keyword?: string }) => {
    setBankLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter?.subject) params.set('subject', filter.subject);
      if (filter?.topic) params.set('topic', filter.topic);
      if (filter?.keyword) params.set('keyword', filter.keyword);
      const res = await fetch(`/api/question-bank?${params.toString()}`);
      const data = await res.json();
      setBankProblems(data.problems || []);
      setBankCategories(data.categories || {});
      setBankTotal(data.total || 0);
    } catch { /* ignore */ }
    finally { setBankLoading(false); }
  };

  // ─── 문제은행에서 퀴즈 시작 ───
  const startBankQuiz = (selected: QuizProblem[]) => {
    setProblems(selected);
    setCurrentIndex(0); setSelectedAnswer(null); setShowExplanation(false);
    setScore({ correct: 0, total: 0 }); setQuizAnswers([]); setConsecutiveCorrect(0);
    setTextAnswer('');
    setMode('quiz');
  };

  // ─── 미리보기 → 퀴즈 시작 ───
  const startQuizFromPreview = () => {
    setCurrentIndex(0); setSelectedAnswer(null); setShowExplanation(false);
    setScore({ correct: 0, total: 0 }); setQuizAnswers([]); setConsecutiveCorrect(0);
    setTextAnswer('');
    setMode('quiz');
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

  // ─── 가로 스와이프 ───
  const NAV_SCREENS = ['home', 'scan', 'quest', 'profile'] as const;
  type NavScreen = typeof NAV_SCREENS[number];
  const swipeStartY = useRef<number | null>(null);
  const swipeStartX = useRef<number | null>(null);
  const swipeDelta = useRef(0);

  const handleSwipeStart = (e: React.TouchEvent) => {
    swipeStartX.current = e.touches[0].clientX;
    swipeStartY.current = e.touches[0].clientY;
    swipeDelta.current = 0;
  };
  const handleSwipeMove = (e: React.TouchEvent) => {
    if (swipeStartX.current === null || swipeStartY.current === null) return;
    const dx = e.touches[0].clientX - swipeStartX.current;
    const dy = e.touches[0].clientY - swipeStartY.current;
    // 세로 움직임이 더 크면 스와이프 무시 (스크롤 보호)
    if (Math.abs(dy) > Math.abs(dx)) return;
    swipeDelta.current = dx;
  };
  const handleSwipeEnd = () => {
    if (swipeStartX.current === null) return;
    const threshold = 80;
    const currentIdx = NAV_SCREENS.indexOf(mode as NavScreen);
    if (currentIdx === -1) { swipeStartX.current = null; return; }

    if (swipeDelta.current < -threshold && currentIdx < NAV_SCREENS.length - 1) {
      // 왼쪽으로 스와이프 → 다음 화면
      const next = NAV_SCREENS[currentIdx + 1];
      setMode(next); setActiveNav(next);
    } else if (swipeDelta.current > threshold && currentIdx > 0) {
      // 오른쪽으로 스와이프 → 이전 화면
      const prev = NAV_SCREENS[currentIdx - 1];
      setMode(prev); setActiveNav(prev);
    }
    swipeStartX.current = null;
    swipeStartY.current = null;
    swipeDelta.current = 0;
  };

  // 스와이프 래퍼 props (인라인으로 각 화면에 직접 적용 — 컴포넌트 내부 정의 시 리마운트로 키보드 닫힘 버그 발생)
  const swipeProps = {
    onTouchStart: handleSwipeStart,
    onTouchMove: handleSwipeMove,
    onTouchEnd: handleSwipeEnd,
  };
  const currentNavIdx = NAV_SCREENS.indexOf(mode as NavScreen);
  const DotIndicator = () => currentNavIdx !== -1 ? (
    <div className="fixed bottom-[76px] left-0 right-0 flex justify-center gap-1.5 z-40 pointer-events-none">
      {NAV_SCREENS.map((_, i) => (
        <div key={i} className={`rounded-full transition-all duration-200 ${i === currentNavIdx ? 'w-4 h-1.5 bg-violet-500' : 'w-1.5 h-1.5 bg-gray-300'}`} />
      ))}
    </div>
  ) : null;

  // ─── 하단 내비 ───
  const BottomNav = () => (
    <div className="fixed bottom-0 left-0 right-0 z-50">
      <div className="max-w-xl mx-auto px-3 pb-2">
        <div className="h-16 bg-white/90 backdrop-blur-xl rounded-2xl shadow-lg shadow-violet-200/30 border border-gray-100 flex items-center justify-around px-2">
          {[
            { id: 'home' as const, icon: '🏠', label: '홈', action: () => { setMode('home'); setActiveNav('home'); } },
            { id: 'scan' as const, icon: '📷', label: '스캔', action: () => { setMode('scan'); setActiveNav('scan'); } },
            { id: 'quest' as const, icon: '📦', label: '문제은행', action: () => { loadBank(); setMode('bank'); setActiveNav('quest'); } },
            { id: 'profile' as const, icon: '👤', label: '내 정보', action: () => { setMode('profile'); setActiveNav('profile'); } },
          ].map(n => (
            <button key={n.id} onClick={n.action} className={`flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-xl transition-all ${activeNav === n.id ? 'text-violet-600 bg-violet-50' : 'text-gray-400 hover:text-gray-600'}`}>
              <span className="text-lg">{n.icon}</span>
              <span className={`text-xs ${activeNav === n.id ? 'font-semibold' : ''}`}>{n.label}</span>
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
  if (mode === 'loading') return (
    <div className="min-h-screen bg-gradient-to-b from-[#0a2265] to-[#1a3a8f] flex items-center justify-center">
      <div className="text-center px-8">
        {/* 서일대 로고 */}
        <img
          src="https://www.seoil.ac.kr/sites/seoil/intro/images/logo_w.png"
          alt="서일대학교"
          className="h-8 mx-auto mb-6 opacity-80"
          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
        <h1 className="text-5xl font-black text-white tracking-tight">
          Bloom<span className="text-yellow-300">Lens</span>
        </h1>
        <p className="text-blue-200 text-sm mt-3 font-medium">센서인은 BloomLens로 성장한다</p>
        <div className="mt-8 flex justify-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-white/40 animate-pulse" style={{animationDelay:'0ms'}} />
          <div className="w-1.5 h-1.5 rounded-full bg-white/40 animate-pulse" style={{animationDelay:'150ms'}} />
          <div className="w-1.5 h-1.5 rounded-full bg-white/40 animate-pulse" style={{animationDelay:'300ms'}} />
        </div>
      </div>
    </div>
  );

  // ═══════════════════════════════════════
  // 온보딩 1: 핵심 가치
  // ═══════════════════════════════════════
  if (mode === 'onboard1') return (
    <div className="min-h-screen bg-gradient-to-b from-violet-50 to-white flex flex-col px-7 py-14">
      <div className="text-center mb-6">
        <span className="text-xs font-bold text-[#0a2265] tracking-widest opacity-60">SEOIL UNIVERSITY · S-AID</span>
        <h1 className="text-2xl font-black text-gray-900 mt-1">Bloom<span className="text-violet-600">Lens</span></h1>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="text-6xl mb-2">📸</div>
        <div className="text-3xl mt-1">→ 🧠 → 🗺️</div>
      </div>
      <div className="text-center mb-8">
        <h2 className="text-xl font-extrabold text-gray-900 leading-relaxed">찍으면, AI가 분석하고<br/>내 학습 맵이 자라요</h2>
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
          <span className="px-3 py-1.5 rounded-lg text-xs bg-yellow-100 text-yellow-600">과학 71%</span>
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
  // 홈 허브 — 맵 + 스캔 중심
  // ═══════════════════════════════════════
  if (mode === 'home') return (
    <div {...swipeProps} className="relative"><div className="min-h-screen bg-gradient-to-b from-violet-50 to-white pb-20">
      <div className="max-w-xl mx-auto px-4 pt-6">
        {/* 헤더 — BloomLens + 키워드 맵 카운트 */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-[#0a2265] to-[#1a3a8f] flex items-center justify-center text-base shadow-md shadow-blue-200">
              <span className="text-white text-xs font-black">BL</span>
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-black text-gray-900">Bloom<span className="text-violet-600">Lens</span></span>
                <span className="text-[9px] font-bold text-[#0a2265]/50 bg-[#0a2265]/5 px-1.5 py-0.5 rounded tracking-wider">S-AID</span>
              </div>
              <div className="text-xs text-violet-500">
                {(game.userKeywords?.length ?? 0) === 0
                  ? '첫 키워드를 심어보세요'
                  : `${game.userKeywords.length}개 키워드 탐색 중`}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {game.streak > 0 && (
              <span className="text-xs text-orange-500 font-bold bg-orange-50 border border-orange-100 px-2 py-1 rounded-lg">🔥{game.streak}일</span>
            )}
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-lg">{game.totalSolved}문제</span>
          </div>
        </div>

        {/* 키워드 맵 영역 */}
        <div className="bg-white/80 backdrop-blur border border-gray-100 rounded-3xl p-5 mb-5 min-h-[200px] flex flex-col justify-center relative overflow-hidden">
          <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle, #7c3aed 1px, transparent 1px)', backgroundSize: '24px 24px' }} />

          {(game.userKeywords?.length ?? 0) === 0 ? (
            <div className="relative z-10">
              {expandedKeywords.length === 0 && !expandingKeywords ? (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-2 text-center">첫번째 학습 키워드를 심어보세요.</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={keywordSeedInput}
                      onChange={e => setKeywordSeedInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && expandKeywords(keywordSeedInput)}
                      placeholder="예: 광합성, 이차방정식..."
                      className="flex-1 px-3 py-2 rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-900 placeholder-gray-300 focus:outline-none focus:border-violet-400 focus:bg-white"
                    />
                    <button
                      onClick={() => expandKeywords(keywordSeedInput)}
                      disabled={!keywordSeedInput.trim()}
                      className="px-3 py-2 rounded-xl bg-violet-600 text-white text-sm font-bold disabled:bg-gray-200 disabled:text-gray-400 transition-colors"
                    >🌱</button>
                  </div>
                  <p className="text-[10px] text-gray-300 text-center mt-2">AI가 관련 키워드를 추천해줄게요</p>
                </div>
              ) : expandingKeywords ? (
                <div className="text-center py-4">
                  <span className="inline-block animate-spin text-2xl">🌱</span>
                  <p className="text-xs text-violet-500 mt-2">키워드 맵을 펼치는 중...</p>
                </div>
              ) : (
                <div>
                  <p className="text-xs font-semibold text-violet-600 mb-2">✨ &quot;{keywordSeedInput}&quot; 관련 키워드</p>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {[keywordSeedInput, ...expandedKeywords].map(kw => (
                      <button
                        key={kw}
                        onClick={() => {
                          setGame(prev => {
                            const merged = Array.from(new Set([...(prev.userKeywords ?? []), kw]));
                            const g = { ...prev, userKeywords: merged };
                            saveGame(g);
                            return g;
                          });
                        }}
                        className="bg-violet-50 border border-violet-200 rounded-xl px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100 active:scale-95 transition-all"
                      >
                        ＋ {kw}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => {
                      setGame(prev => {
                        const all = [keywordSeedInput, ...expandedKeywords];
                        const merged = Array.from(new Set([...(prev.userKeywords ?? []), ...all]));
                        const g = { ...prev, userKeywords: merged };
                        saveGame(g);
                        return g;
                      });
                      setExpandedKeywords([]);
                      setKeywordSeedInput('');
                    }}
                    className="w-full py-2 rounded-xl bg-violet-600 text-white text-xs font-bold"
                  >전체 추가 ({1 + expandedKeywords.length}개)</button>
                </div>
              )}
            </div>
          ) : (
            <div className="relative z-10 w-full">
              <div className="flex flex-wrap gap-2">
                {game.userKeywords.map(kw => (
                  <button
                    key={kw}
                    onClick={() => { loadBank({ keyword: kw }); setBankFilter({ keyword: kw }); setMode('bank'); setActiveNav('quest'); }}
                    className="bg-violet-50 border border-violet-200 rounded-xl px-3 py-2 text-left hover:bg-violet-100 active:scale-95 transition-all"
                  >
                    <div className="text-xs font-bold text-violet-700">{kw}</div>
                    <div className="text-[10px] text-violet-400 mt-0.5">탭해서 풀기</div>
                  </button>
                ))}
                <button
                  onClick={goScan}
                  className="border-2 border-dashed border-gray-200 rounded-xl px-3 py-2 flex flex-col items-center justify-center hover:border-violet-300 transition-colors"
                >
                  <div className="text-xs font-medium text-gray-400">＋</div>
                  <div className="text-[10px] text-gray-300 mt-0.5">키워드 추가</div>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 메인 CTA — 스캔 */}
        <button onClick={goScan} className="w-full py-4 rounded-2xl bg-gradient-to-r from-violet-600 to-violet-500 text-white font-bold text-[15px] shadow-lg shadow-violet-300/30 active:scale-[0.98] transition-transform">
          📷 시험지 스캔하기
        </button>
      </div>
      <BottomNav />
      <LevelUpModal />
      <DotIndicator />
    </div></div>
  );

  // ═══════════════════════════════════════
  // 스캔 화면 (촬영 전 안내 포함)
  // ═══════════════════════════════════════
  if (mode === 'scan') return (
    <div {...swipeProps} className="relative"><div className="min-h-screen bg-gradient-to-b from-violet-50 to-white pb-20">
      <div className="max-w-xl mx-auto px-4 py-6">
        <div className="text-center mb-5">
          <h1 className="text-xl font-bold text-gray-900">📷 시험지 스캔</h1>
          <p className="text-xs text-gray-500 mt-1">틀린 문제를 찍으면 AI가 분석해줘요</p>
        </div>

        {/* 탭 */}
        <div className="flex bg-gray-100 rounded-xl p-1 mb-4">
          <button onClick={() => setTab('photo')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'photo' ? 'bg-violet-600 text-white' : 'text-gray-500'}`}>📷 사진으로 풀기</button>
          <button onClick={() => setTab('keyword')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'keyword' ? 'bg-violet-600 text-white' : 'text-gray-500'}`}>🔑 키워드로 풀기</button>
        </div>

        {/* 사진 탭 */}
        {tab === 'photo' && (
          <>
            <div className="bg-white shadow-sm border border-gray-100 rounded-2xl p-5 mb-4">
              {/* 카메라 촬영용 input */}
              <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={handleImageSelect} className="hidden" />
              {/* 갤러리 선택용 input (capture 없음) */}
              <input ref={galleryInputRef} type="file" accept="image/*" onChange={handleImageSelect} className="hidden" />

              {imagePreview ? (
                <div className="relative mb-3">
                  <img src={imagePreview} alt="업로드된 문제" className="w-full rounded-xl border border-gray-200 max-h-72 object-contain bg-gray-100" />
                  <button onClick={() => { setImageFile(null); setImagePreview(null); setParseResult(null); }} className="absolute top-2 right-2 w-7 h-7 bg-black/40 text-white rounded-full flex items-center justify-center text-xs">✕</button>
                </div>
              ) : (
                <div className="flex gap-3 mb-3">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex-1 h-36 border-2 border-dashed border-violet-300 rounded-xl flex flex-col items-center justify-center gap-2 text-violet-600/70 hover:border-violet-400 hover:bg-violet-50/50 transition-colors active:scale-95"
                  >
                    <span className="text-3xl">📷</span>
                    <span className="text-xs font-medium">촬영하기</span>
                  </button>
                  <button
                    onClick={() => galleryInputRef.current?.click()}
                    className="flex-1 h-36 border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center gap-2 text-gray-500/70 hover:border-gray-400 hover:bg-gray-50/50 transition-colors active:scale-95"
                  >
                    <span className="text-3xl">🖼️</span>
                    <span className="text-xs font-medium">갤러리 선택</span>
                  </button>
                </div>
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

        {/* 키워드 탭 */}
        {tab === 'keyword' && (
          <>
            <div className="bg-white shadow-sm border border-gray-100 rounded-2xl p-5 mb-4">
              <h2 className="text-sm font-semibold text-gray-900 mb-1">🔑 키워드로 문제 찾기</h2>
              <p className="text-xs text-gray-500 mb-4">문제은행에서 해당 키워드 문제를 바로 꺼내 풀어요</p>
              <input
                type="text"
                value={keywordInput}
                onChange={e => setKeywordInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && generateFromKeyword(keywordInput)}
                placeholder="예: 광합성, 이차방정식, 세포분열..."
                className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-900 placeholder-gray-300 focus:outline-none focus:border-violet-400 focus:bg-white mb-3"
              />
              {/* 내 맵 키워드 빠른 선택 */}
              {(game.userKeywords?.length ?? 0) > 0 && (
                <div className="mb-3">
                  <p className="text-xs text-gray-400 mb-2">📌 내 맵에서 선택</p>
                  <div className="flex flex-wrap gap-1.5">
                    {game.userKeywords.map(kw => (
                      <button
                        key={kw}
                        onClick={() => setKeywordInput(kw)}
                        className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${keywordInput === kw ? 'bg-violet-600 text-white border-violet-600' : 'bg-violet-50 text-violet-600 border-violet-200 hover:bg-violet-100'}`}
                      >
                        {kw}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="text-xs font-medium text-gray-400 mb-1.5 block">문제 수</label>
                  <select value={count} onChange={e => setCount(Number(e.target.value))} className="w-full py-1.5 px-2 rounded-lg border border-gray-200 bg-gray-100 text-sm text-gray-900">{[3,5,10].map(n => <option key={n} value={n}>{n}문제</option>)}</select>
                </div>
              </div>
            </div>
            <button
              onClick={() => generateFromKeyword(keywordInput)}
              disabled={!keywordInput.trim() || loading}
              className="w-full py-4 rounded-2xl bg-gradient-to-r from-violet-600 to-violet-500 text-white font-bold disabled:bg-gray-200 disabled:text-gray-400 transition-colors"
            >
              {loading ? '문제 찾는 중...' : `🔑 "${keywordInput || '키워드'}" 문제 풀기`}
            </button>
          </>
        )}
      </div>
      <BottomNav />
      <DotIndicator />
    </div></div>
  );

  // ═══════════════════════════════════════
  // 파싱 결과 (촬영 후 안내)
  // ═══════════════════════════════════════
  if (mode === 'parsed' && parseResult) return (
    <div className="min-h-screen bg-gradient-to-b from-violet-50 to-white pb-20">
      <div className="max-w-xl mx-auto px-4 py-6">
        <button onClick={goScan} className="text-violet-600 text-sm mb-3 flex items-center gap-1">← 다시 촬영</button>

        <div className="text-center mb-5">
          <div className="text-3xl mb-1">🎯</div>
          <h2 className="text-lg font-extrabold text-gray-900">{parseResult.problems.length}문제 발견!</h2>
          <p className="text-xs text-gray-500">{parseResult.overall_subject} · {parseResult.source_description}</p>
        </div>

        {/* 촬영 후 안내 */}
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 mb-4">
          <p className="text-xs text-green-600 leading-relaxed">✨ <strong>선택한 문제를 기반으로</strong> AI가 같은 개념, 다른 숫자의 유사 문제를 만들어요. 진짜 이해했는지 확인!</p>
        </div>

        {/* 문제 목록 */}
        <div className="space-y-2 mb-4">
          {parseResult.problems.map((p, idx) => (
            <div key={idx} onClick={() => setSelectedParsedIdx(prev => prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx])}
              className={`bg-white shadow-sm rounded-xl p-3 border-2 cursor-pointer transition-colors ${selectedParsedIdx.includes(idx) ? 'border-violet-400' : 'border-transparent'}`}>
              <div className="flex items-start gap-2">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${selectedParsedIdx.includes(idx) ? 'bg-violet-600 text-gray-900' : 'bg-gray-200 text-gray-500'}`}>{idx + 1}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-700 leading-relaxed line-clamp-2">{p.question_text}</p>
                  <div className="flex gap-1 mt-1.5 flex-wrap">
                    <span className="px-1.5 py-0.5 bg-violet-100 text-violet-600 text-xs rounded">{p.subject}</span>
                    <span className="px-1.5 py-0.5 bg-gray-100 text-gray-400 text-xs rounded">{p.topic}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
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
          {loading ? <span><span className="inline-block animate-spin mr-2">⏳</span>유사 문제 생성 중...</span> : `⚡ ${selectedParsedIdx.length}문제로 연습 시작`}
        </button>
      </div>
      <BottomNav />
    </div>
  );

  // ═══════════════════════════════════════
  // 미리보기 (생성된 문제 확인)
  // ═══════════════════════════════════════
  if (mode === 'preview' && problems.length > 0) {
    const diffLabelsPreview: Record<number, string> = { 1: '하', 2: '중', 3: '상' };
    return (
      <div className="min-h-screen bg-gradient-to-b from-violet-50 to-white pb-20">
        <div className="max-w-xl mx-auto px-4 py-6">
          <div className="text-center mb-5">
            <div className="text-3xl mb-1">📝</div>
            <h2 className="text-lg font-extrabold text-gray-900">문제 {problems.length}개 생성 완료!</h2>
            <p className="text-xs text-gray-500 mt-1">문제은행에 저장되었어요</p>
          </div>

          {/* 저장 확인 배지 */}
          <div className="bg-green-50 border border-green-200 rounded-xl p-2.5 mb-4 text-center">
            <span className="text-xs text-green-600 font-medium">✅ 문제은행에 저장 완료 — 언제든 다시 풀 수 있어요</span>
          </div>

          {/* 문제 목록 */}
          <div className="space-y-2 mb-5">
            {problems.map((p, idx) => (
              <div key={idx} className="bg-white shadow-sm rounded-xl border border-gray-100 overflow-hidden">
                <div
                  onClick={() => setPreviewExpanded(previewExpanded === idx ? null : idx)}
                  className="p-3.5 cursor-pointer"
                >
                  <div className="flex items-start gap-2">
                    <div className="w-6 h-6 rounded-full bg-violet-100 flex items-center justify-center text-xs font-bold text-violet-600 flex-shrink-0">{idx + 1}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-700 leading-relaxed line-clamp-2"><MathText text={p.question_text} /></p>
                      <div className="flex gap-1 mt-1.5 flex-wrap">
                        {p.subject && <span className="px-1.5 py-0.5 bg-violet-100 text-violet-600 text-[10px] rounded">{p.subject}</span>}
                        {p.topic && <span className="px-1.5 py-0.5 bg-gray-100 text-gray-400 text-[10px] rounded">{p.topic}</span>}
                        {p.difficulty && <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-600 text-[10px] rounded">{diffLabelsPreview[p.difficulty] || '중'}</span>}
                        {p.bloom_level && <span className="px-1.5 py-0.5 bg-blue-50 text-blue-500 text-[10px] rounded">{bloomLabels[p.bloom_level] || '이해'}</span>}
                      </div>
                    </div>
                    <span className="text-gray-300 text-xs">{previewExpanded === idx ? '▲' : '▼'}</span>
                  </div>
                </div>
                {/* 펼치면 선택지만 보기 (정답은 숨김) */}
                {previewExpanded === idx && p.choices && p.choices.length > 0 && (
                  <div className="px-3.5 pb-3.5 border-t border-gray-50">
                    <div className="text-[10px] text-gray-400 mb-1.5 mt-2">선택지 미리보기</div>
                    <div className="space-y-1">
                      {p.choices.map((c, ci) => (
                        <div key={ci} className="text-xs text-gray-500 bg-gray-50 rounded-lg px-2.5 py-1.5"><MathText text={c} /></div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* CTA */}
          <div className="space-y-2.5">
            <button onClick={startQuizFromPreview} className="w-full py-4 rounded-2xl bg-gradient-to-r from-violet-600 to-violet-500 text-white font-bold text-[15px] shadow-lg shadow-violet-300/30 active:scale-[0.98] transition-transform">
              ▶️ 지금 풀어보기
            </button>
            <button onClick={goScan} className="w-full py-3 rounded-xl bg-violet-50 border border-violet-200 text-violet-600 font-medium text-sm">
              📷 다른 문제 스캔하기
            </button>
          </div>
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
            <p className="text-sm font-medium text-gray-900 leading-relaxed whitespace-pre-wrap"><MathText text={problem.question_text} /></p>
          </div>

          {/* 선택지 or 주관식 입력 */}
          {problem.choices && problem.choices.length > 0 ? (
            <div className="space-y-2.5 mb-4">
              {problem.choices.map((choice, idx) => {
                const num = String(idx + 1);
                const isSelected = selectedAnswer === num;
                const isCorrect = num === normalizeAnswer(problem.correct_answer);
                let cls = 'w-full text-left p-3.5 rounded-xl border-2 transition-all text-sm ';
                if (selectedAnswer === null) cls += 'border-gray-100 hover:border-violet-300 text-gray-700';
                else if (isCorrect) cls += 'border-green-300 bg-green-50 text-green-600';
                else if (isSelected && !isCorrect) cls += 'border-red-300 bg-red-50 text-red-600';
                else cls += 'border-gray-100 text-gray-400';
                return <button key={idx} onClick={() => handleAnswer(idx)} className={cls}><MathText text={choice} /></button>;
              })}
            </div>
          ) : (
            <div className="mb-4">
              <div className="bg-violet-50 border border-violet-200 rounded-xl px-3 py-1.5 mb-2">
                <span className="text-xs text-violet-600 font-medium">✏️ {problem.question_type === 'essay' ? '서술형' : '주관식'} — 답을 직접 입력하세요</span>
              </div>
              {problem.question_type === 'essay' ? (
                <textarea
                  value={textAnswer} onChange={e => setTextAnswer(e.target.value)}
                  disabled={selectedAnswer !== null}
                  placeholder="풀이 과정과 답을 작성하세요..."
                  className="w-full p-3.5 rounded-xl border-2 border-gray-100 text-sm min-h-[120px] resize-none focus:border-violet-300 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
                />
              ) : (
                <input
                  type="text" value={textAnswer} onChange={e => setTextAnswer(e.target.value)}
                  disabled={selectedAnswer !== null}
                  placeholder="답을 입력하세요 (예: -6, a = 3)"
                  onKeyDown={e => { if (e.key === 'Enter') handleTextSubmit(); }}
                  className="w-full p-3.5 rounded-xl border-2 border-gray-100 text-sm focus:border-violet-300 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
                />
              )}
              {selectedAnswer === null && (
                <button onClick={handleTextSubmit} disabled={!textAnswer.trim()}
                  className="w-full mt-2 py-3 rounded-xl bg-gradient-to-r from-violet-600 to-violet-500 text-white font-medium disabled:bg-gray-200 disabled:text-gray-400 transition-colors">
                  제출하기
                </button>
              )}
              {/* 제출 후 정답 표시 */}
              {selectedAnswer !== null && (
                <div className={`mt-2 p-3 rounded-xl border text-sm ${
                  problem.question_type === 'essay' ? 'bg-blue-50 border-blue-200 text-blue-700' :
                  isShortAnswerCorrect(selectedAnswer, problem.correct_answer) ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'
                }`}>
                  <div className="text-xs font-bold mb-1">
                    {problem.question_type === 'essay' ? '📝 모범답안 확인' :
                     isShortAnswerCorrect(selectedAnswer, problem.correct_answer) ? '👏 정답!' : '❌ 오답'}
                  </div>
                  <div className="text-xs"><span className="font-medium">정답:</span> <MathText text={problem.correct_answer} /></div>
                </div>
              )}
            </div>
          )}

          {/* 해설 */}
          {showExplanation && (() => {
            const isMultipleChoice = problem.choices && problem.choices.length > 0;
            const answered = selectedAnswer || '';
            const wasCorrect = isMultipleChoice
              ? answered === normalizeAnswer(problem.correct_answer)
              : problem.question_type === 'essay' ? false : isShortAnswerCorrect(answered, problem.correct_answer);
            const isEssayType = problem.question_type === 'essay';
            return (
            <>
              {/* 정답/오답 피드백 — 객관식 & 주관식 공통 (서술형은 주관식 블록에서 이미 표시) */}
              {isMultipleChoice && (
              <div className={`rounded-xl p-4 mb-3 border ${wasCorrect ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                <div className="text-xs font-bold mb-1" style={{ color: wasCorrect ? '#34d399' : '#f87171' }}>
                  {wasCorrect
                    ? (consecutiveCorrect >= 3 ? '🔥 완벽해요! 연속 정답 보너스!' : '👏 정확해요!')
                    : '아깝다! 핵심 포인트를 확인해봐요'}
                </div>
              </div>
              )}
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
                <h3 className="font-semibold text-amber-700 text-xs mb-1.5">해설</h3>
                <p className="text-xs text-amber-600 leading-relaxed whitespace-pre-wrap"><MathText text={problem.explanation} /></p>
              </div>
              <button onClick={nextProblem} className="w-full py-3 rounded-xl bg-gradient-to-r from-violet-600 to-violet-500 text-white font-medium">
                {currentIndex + 1 >= problems.length ? '결과 보기' : '다음 문제'}
              </button>
            </>
            );
          })()}
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

          {/* 키워드 → 맵에 추가 */}
          {(() => {
            const allKw = Array.from(new Set(quizAnswers.flatMap(a => a.keywords || []))).filter(Boolean);
            if (allKw.length === 0) return null;
            const userKw = game.userKeywords ?? [];
            const newKw = allKw.filter(k => !userKw.includes(k));
            const existingKw = allKw.filter(k => userKw.includes(k));
            return (
              <div className="bg-violet-50 border border-violet-200 rounded-2xl p-4 mb-4">
                <div className="text-xs font-bold text-violet-700 mb-2">🗺️ 이번 문제의 키워드</div>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {allKw.map(kw => (
                    <span key={kw} className={`text-xs px-2.5 py-1 rounded-lg font-medium ${userKw.includes(kw) ? 'bg-violet-200 text-violet-700' : 'bg-white border border-violet-300 text-violet-600'}`}>
                      {userKw.includes(kw) ? '✓ ' : ''}{kw}
                    </span>
                  ))}
                </div>
                {newKw.length > 0 && (
                  <button
                    onClick={() => {
                      setGame(prev => {
                        const merged = Array.from(new Set([...(prev.userKeywords ?? []), ...newKw]));
                        const g = { ...prev, userKeywords: merged };
                        saveGame(g);
                        return g;
                      });
                    }}
                    className="w-full py-2 rounded-xl bg-violet-600 text-white text-xs font-bold active:scale-95 transition-transform"
                  >
                    ＋ {newKw.length}개 키워드를 내 맵에 추가
                  </button>
                )}
                {newKw.length === 0 && (
                  <p className="text-xs text-violet-500 text-center">✓ 이미 내 맵에 있는 키워드예요</p>
                )}
              </div>
            );
          })()}

          {/* CTA */}
          <div className="space-y-2.5">
            <button onClick={() => { setCurrentIndex(0); setSelectedAnswer(null); setShowExplanation(false); setScore({correct:0,total:0}); setQuizAnswers([]); setConsecutiveCorrect(0); setTextAnswer(''); setMode('quiz'); }}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-600 to-yellow-500 text-black font-bold text-sm">🔄 같은 문제 다시 풀기</button>
            <button onClick={() => { loadBank(); setMode('bank'); setActiveNav('quest'); }}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-violet-600 to-violet-500 text-white font-medium">📦 문제은행 보기</button>
            <button onClick={goScan} className="w-full py-3 rounded-xl bg-violet-50 border border-violet-200 text-violet-600 font-medium">📷 새 문제 스캔하기</button>
          </div>
        </div>
        <BottomNav />
        <LevelUpModal />
      </div>
    );
  }

  // ═══════════════════════════════════════
  // 문제은행 (bank)
  // ═══════════════════════════════════════
  if (mode === 'quest' || mode === 'bank') {
    const subjects = Object.keys(bankCategories);
    const totalBankCount = Object.values(bankCategories).reduce((acc, topics) => acc + Object.values(topics).reduce((a, b) => a + b, 0), 0);

    return (
    <div {...swipeProps} className="relative"><div className="min-h-screen bg-gradient-to-b from-violet-50 to-white pb-20">
      <div className="max-w-xl mx-auto px-4 py-6">
        <div className="text-center mb-5">
          <h1 className="text-xl font-bold text-gray-900">📦 문제은행</h1>
          <p className="text-xs text-gray-500 mt-1">생성된 문제가 여기 쌓여요 · 총 {totalBankCount}문제</p>
        </div>

        {bankLoading ? (
          <div className="text-center py-12">
            <span className="inline-block animate-spin text-2xl">⏳</span>
            <p className="text-xs text-gray-400 mt-2">불러오는 중...</p>
          </div>
        ) : totalBankCount === 0 ? (
          <div className="text-center py-12">
            <div className="text-5xl mb-4 opacity-30">📦</div>
            <p className="text-sm text-gray-400 font-medium mb-1">아직 저장된 문제가 없어요</p>
            <p className="text-xs text-gray-300 mb-4">시험지를 스캔하면 자동으로 쌓여요</p>
            <button onClick={goScan} className="px-6 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-medium">📷 스캔하러 가기</button>
          </div>
        ) : (
          <>
            {/* 필터 */}
            {bankFilter.subject && (
              <div className="flex items-center gap-2 mb-3">
                <button onClick={() => { setBankFilter({}); loadBank(); }} className="text-xs text-violet-600 flex items-center gap-0.5">← 전체</button>
                <span className="text-xs text-gray-500">{bankFilter.subject}{bankFilter.topic ? ` > ${bankFilter.topic}` : ''}</span>
              </div>
            )}

            {/* 과목별 카테고리 */}
            {!bankFilter.subject && subjects.map(subject => {
              const topics = bankCategories[subject];
              const subjectTotal = Object.values(topics).reduce((a, b) => a + b, 0);
              return (
                <div key={subject} className="bg-white shadow-sm border border-gray-100 rounded-2xl p-4 mb-3">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-bold text-gray-900">{subject}</span>
                    <span className="text-xs text-gray-400">{subjectTotal}문제</span>
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    {Object.entries(topics).map(([topic, count]) => (
                      <button key={topic}
                        onClick={() => { setBankFilter({ subject, topic }); loadBank({ subject, topic }); }}
                        className="px-2.5 py-1.5 bg-violet-50 hover:bg-violet-100 border border-violet-200 rounded-lg text-xs text-violet-600 transition-colors">
                        {topic} <span className="text-violet-400">({count})</span>
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => { setBankFilter({ subject }); loadBank({ subject }); }}
                    className="mt-2 w-full py-2 rounded-lg bg-violet-50 text-violet-600 text-xs font-medium">
                    ▶️ {subject} 전체 {Math.min(subjectTotal, 5)}문제 풀기
                  </button>
                </div>
              );
            })}

            {/* 필터된 문제 목록 */}
            {bankFilter.subject && bankProblems.length > 0 && (
              <>
                <div className="space-y-2 mb-4">
                  {bankProblems.slice(0, 10).map((p, idx) => (
                    <div key={p.id || idx} className="bg-white shadow-sm rounded-xl border border-gray-100 p-3">
                      <p className="text-xs text-gray-700 leading-relaxed line-clamp-2"><MathText text={p.question_text} /></p>
                      <div className="flex gap-1 mt-1.5">
                        {p.topic && <span className="px-1.5 py-0.5 bg-gray-100 text-gray-400 text-[10px] rounded">{p.topic}</span>}
                        <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-600 text-[10px] rounded">{diffLabels[p.difficulty || 2]}</span>
                        <span className="px-1.5 py-0.5 text-gray-300 text-[10px]">
                          {(p as QuizProblem & { times_served?: number; times_correct?: number }).times_served
                            ? `${(p as QuizProblem & { times_correct?: number }).times_correct || 0}/${(p as QuizProblem & { times_served?: number }).times_served} 정답`
                            : '미풀이'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => startBankQuiz(bankProblems.slice(0, Math.min(bankProblems.length, 5)))}
                  className="w-full py-4 rounded-2xl bg-gradient-to-r from-violet-600 to-violet-500 text-white font-bold text-[15px] shadow-lg shadow-violet-300/30">
                  ▶️ {Math.min(bankProblems.length, 5)}문제 풀기
                </button>
              </>
            )}
          </>
        )}
      </div>
      <BottomNav />
      <DotIndicator />
    </div></div>
    );
  }

  // ═══════════════════════════════════════
  // 프로필 — 통계 + 미션 + 뱃지 통합
  // ═══════════════════════════════════════
  if (mode === 'profile') return (
    <div {...swipeProps} className="relative"><div className="min-h-screen bg-gradient-to-b from-violet-50 to-white pb-20">
      <div className="max-w-xl mx-auto px-4 py-6">
        {/* 프로필 헤더 */}
        <div className="text-center mb-5">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-600 to-violet-400 flex items-center justify-center text-3xl mx-auto mb-2 border-3 border-yellow-400/50">🧠</div>
          <h2 className="text-lg font-extrabold text-gray-900">Lv.{game.level} {levelTitle(game.level)}</h2>
          <XpBar />
        </div>

        {/* 핵심 통계 4칸 */}
        <div className="grid grid-cols-4 gap-1.5 mb-4">
          {[
            { v: game.totalSolved, l: '푼 문제', c: 'text-gray-900' },
            { v: game.totalSolved > 0 ? `${Math.round((game.totalCorrect / game.totalSolved) * 100)}%` : '0%', l: '정답률', c: 'text-violet-600' },
            { v: game.qp, l: 'QP', c: 'text-yellow-600' },
            { v: `${game.streak}일`, l: '연속', c: 'text-orange-500' },
          ].map((s, i) => (
            <div key={i} className="bg-white shadow-sm rounded-xl p-2.5 text-center">
              <div className={`text-sm font-extrabold ${s.c}`}>{s.v}</div>
              <div className="text-[10px] text-gray-400">{s.l}</div>
            </div>
          ))}
        </div>

        {/* 일일 미션 (홈에서 이동) */}
        <div className="bg-white shadow-sm border border-violet-200 rounded-2xl p-4 mb-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-bold text-violet-600">📋 오늘의 미션</span>
            <span className="text-xs text-gray-500">{(game.totalSolved >= 3 ? 1 : 0) + (game.totalSolved >= 1 ? 1 : 0)}/3</span>
          </div>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between"><span className={game.totalSolved >= 3 ? 'text-gray-400 line-through' : 'text-gray-700'}>{game.totalSolved >= 3 ? '✅' : '⬜'} 문제 3개 풀기</span><span className="text-violet-600">+30 QP</span></div>
            <div className="flex justify-between"><span className="text-gray-700">⬜ 새 시험지 스캔</span><span className="text-violet-600">+50 QP</span></div>
            <div className="flex justify-between"><span className="text-gray-700">⬜ 오답 특훈 1회</span><span className="text-violet-600">+40 QP</span></div>
          </div>
        </div>

        {/* 카테고리 */}
        {game.categories.length > 0 && (
          <div className="bg-white shadow-sm border border-gray-100 rounded-2xl p-4 mb-4">
            <div className="text-xs font-bold text-gray-900 mb-2">🏷 탐험한 영역</div>
            <div className="flex gap-1.5 flex-wrap">{game.categories.map(c => <span key={c} className="px-2.5 py-1 bg-violet-100 text-violet-600 text-xs rounded-lg">{c}</span>)}</div>
          </div>
        )}

        {/* 뱃지 */}
        <div className="bg-white shadow-sm border border-gray-100 rounded-2xl p-4 mb-4">
          <div className="text-xs font-bold text-gray-900 mb-2">🏅 뱃지</div>
          <div className="flex gap-2">
            {[1,2,3,4].map(i => <div key={i} className="w-10 h-10 rounded-xl bg-gray-100 border border-dashed border-gray-200 flex items-center justify-center text-sm text-gray-600">🔒</div>)}
          </div>
          <p className="text-xs text-gray-400 mt-2">과목별 정답률 80% + 20문제 이상 풀면 뱃지 획득!</p>
        </div>

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
      <DotIndicator />
    </div></div>
  );

  return null;
}

