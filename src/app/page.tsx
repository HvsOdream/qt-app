'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { signOut } from '@/lib/supabase';

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
  studyGrade: string;    // 학년/상황 (예: 고2, 정보처리기사)
  studySubject: string;  // 과목/전공 (예: 수학, 자료구조)
}

const DEFAULT_GAME: GameState = {
  xp: 0, level: 1, qp: 0, streak: 0,
  lastPlayDate: '', totalSolved: 0, totalCorrect: 0,
  onboardDone: false, categories: [], userKeywords: [],
  studyGrade: '', studySubject: '',
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
  // 홈 문제 생성 입력
  const [homeGrade, setHomeGrade] = useState('');
  const [homeSubject, setHomeSubject] = useState('');
  const [homeUnit, setHomeUnit] = useState('');
  const [showGoalModal, setShowGoalModal] = useState(false);  // 바텀시트
  const [activeNav, setActiveNav] = useState<'home' | 'scan' | 'quest' | 'profile'>('home');
  // 꽃 피는 로딩
  const [bloomStage, setBloomStage] = useState(0);
  const [bloomCountdown, setBloomCountdown] = useState(0);
  const bloomTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
  const [bankPlayCount, setBankPlayCount] = useState(5);
  const [previewExpanded, setPreviewExpanded] = useState<number | null>(null);
  // parsed 화면 키워드 태그
  const [parsedKeywordTag, setParsedKeywordTag] = useState('');
  // 오답노트
  const [wrongNoteProblems, setWrongNoteProblems] = useState<(QuizProblem & { wrong_count?: number; last_wrong?: string; student_answer?: string })[]>([]);
  const [wrongNoteLoading, setWrongNoteLoading] = useState(false);
  const [wrongNoteSubjects, setWrongNoteSubjects] = useState<Record<string, number>>({});
  // 프로필 탭
  const [profileTab, setProfileTab] = useState<'stats' | 'wrongnote'>('stats');

  // ─── 초기화 ───
  useEffect(() => {
    const g = loadGame();
    setGame(g);
    // 이전 학습 설정 복원
    if (g.studyGrade) setHomeGrade(g.studyGrade);
    if (g.studySubject) setHomeSubject(g.studySubject);
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
    startBloomTimer(20);
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
      stopBloomTimer();
      setMode('parsed');
    } catch {
      stopBloomTimer();
      alert('이미지 분석에 실패했습니다. 다시 시도해주세요.');
    } finally { setParsing(false); }
  };

  // ─── 꽃 로딩 타이머 시작/종료 ───
  const startBloomTimer = (estimatedSec: number) => {
    setBloomStage(0);
    setBloomCountdown(estimatedSec);
    let elapsed = 0;
    if (bloomTimerRef.current) clearInterval(bloomTimerRef.current);
    bloomTimerRef.current = setInterval(() => {
      elapsed += 1;
      setBloomCountdown(Math.max(0, estimatedSec - elapsed));
      setBloomStage(Math.min(4, Math.floor((elapsed / estimatedSec) * 4)));
      if (elapsed >= estimatedSec + 5) {
        if (bloomTimerRef.current) clearInterval(bloomTimerRef.current);
      }
    }, 1000);
  };
  const stopBloomTimer = () => {
    if (bloomTimerRef.current) { clearInterval(bloomTimerRef.current); bloomTimerRef.current = null; }
    setBloomStage(5); // 완료
  };

  // ─── 유사 문제 생성 (병렬) ───
  const generateSimilar = async () => {
    if (!parseResult || selectedParsedIdx.length === 0) return;
    setLoading(true);
    // 예상 시간: 문제 1개당 약 12초, 병렬이므로 최대 1개 기준
    startBloomTimer(15);
    try {
      // 순차 → Promise.all 병렬 처리
      const results = await Promise.all(
        selectedParsedIdx.map(idx => {
          const original = parseResult.problems[idx];
          return fetch('/api/generate-similar', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ originalProblem: original, count: Math.max(1, Math.floor(count / selectedParsedIdx.length)), difficulty }),
          }).then(async r => {
            const d = await r.json();
            if (!r.ok) console.error('generate-similar 오류:', d.error);
            return d;
          }).catch(e => { console.error('네트워크 오류:', e); return { problems: [] }; });
        })
      );
      const allProblems: QuizProblem[] = results.flatMap(d => d.problems || []);
      if (allProblems.length > 0) {
        setProblems(allProblems.slice(0, count));
        setCurrentIndex(0); setSelectedAnswer(null); setShowExplanation(false);
        setScore({ correct: 0, total: 0 }); setQuizAnswers([]); setConsecutiveCorrect(0);
        setPreviewExpanded(null);
        stopBloomTimer();
        setMode('preview');
      } else {
        stopBloomTimer();
        alert('문제 생성에 실패했습니다. 다시 시도해주세요.');
      }
    } catch {
      stopBloomTimer();
      alert('문제 생성에 실패했습니다.');
    }
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

  // ─── 학습 목표 기반 문제 생성 (홈) ───
  const generateFromGoal = async () => {
    if (!homeSubject.trim()) return;
    const topic = homeUnit.trim() || homeSubject.trim();
    setLoading(true);
    startBloomTimer(15);
    // 학습 설정 저장
    setGame(prev => {
      const g = { ...prev, studyGrade: homeGrade.trim(), studySubject: homeSubject.trim() };
      saveGame(g);
      return g;
    });
    try {
      const res = await fetch('/api/generate-by-topic', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grade: homeGrade.trim(),
          subject: homeSubject.trim(),
          topic,
          difficulty,
          count,
        }),
      });
      const data = await res.json();
      const allProblems: QuizProblem[] = data.problems || [];
      if (allProblems.length > 0) {
        setProblems(allProblems.slice(0, count));
        setCurrentIndex(0); setSelectedAnswer(null); setShowExplanation(false);
        setScore({ correct: 0, total: 0 }); setQuizAnswers([]); setConsecutiveCorrect(0);
        setPreviewExpanded(null);
        stopBloomTimer();
        setMode('preview');
      } else {
        stopBloomTimer();
        alert('문제 생성에 실패했습니다. 다시 시도해주세요.');
      }
    } catch {
      stopBloomTimer();
      alert('문제 생성 중 오류가 발생했습니다.');
    } finally { setLoading(false); }
  };


  // ─── 문제은행 불러오기 ───
  const loadBank = async (filter?: { subject?: string; topic?: string; keyword?: string }, forceRefreshCategories = false) => {
    setBankLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter?.subject) params.set('subject', filter.subject);
      if (filter?.topic) params.set('topic', filter.topic);
      if (filter?.keyword) params.set('keyword', filter.keyword);
      // bankCategories가 이미 로드된 경우 summary 쿼리 스킵 (성능 최적화)
      const hasCats = Object.keys(bankCategories).length > 0;
      if (hasCats && !forceRefreshCategories) params.set('skipSummary', 'true');
      const res = await fetch(`/api/question-bank?${params.toString()}`);
      const data = await res.json();
      setBankProblems(data.problems || []);
      if (data.categories) setBankCategories(data.categories);
      setBankTotal(data.total || 0);
    } catch { /* ignore */ }
    finally { setBankLoading(false); }
  };

  // ─── 오답노트 불러오기 ───
  const loadWrongNote = async () => {
    setWrongNoteLoading(true);
    try {
      const res = await fetch('/api/wrong-answers');
      const data = await res.json();
      setWrongNoteProblems(data.problems || []);
      setWrongNoteSubjects(data.subjects || {});
    } catch { /* ignore */ }
    finally { setWrongNoteLoading(false); }
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
    // 문제은행 하위 카테고리에서는 스와이프 비활성화
    if ((mode === 'bank' || mode === 'quest') && bankFilter.subject) {
      swipeStartX.current = null;
      swipeStartY.current = null;
      swipeDelta.current = 0;
      return;
    }
    // bank 모드는 quest 위치(인덱스 2)로 처리
    const effectiveMode = mode === 'bank' ? 'quest' : mode;
    const currentIdx = NAV_SCREENS.indexOf(effectiveMode as NavScreen);
    if (currentIdx === -1) { swipeStartX.current = null; return; }

    if (swipeDelta.current < -threshold && currentIdx < NAV_SCREENS.length - 1) {
      const next = NAV_SCREENS[currentIdx + 1];
      setMode(next); setActiveNav(next);
    } else if (swipeDelta.current > threshold && currentIdx > 0) {
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
  const currentNavIdx = mode === 'bank'
    ? NAV_SCREENS.indexOf('quest' as NavScreen)
    : NAV_SCREENS.indexOf(mode as NavScreen);
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
            { id: 'profile' as const, icon: '👤', label: '내 정보', action: () => { setMode('profile'); setActiveNav('profile'); loadWrongNote(); setProfileTab('stats'); } },
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

  // ─── 꽃 피는 로딩 오버레이 ───
  const BLOOM_EMOJIS = ['🌱', '🌿', '🌸', '🌺', '🌻'];
  const PARSE_MSGS  = ['시험지 읽는 중...', '글자 인식 중...', '문제 구조화 중...', '과목 분류 중...', '분석 완료!'];
  const GEN_MSGS    = ['개념 이해 중...', '문제 설계 중...', '선택지 구성 중...', '마무리 다듬는 중...', '완성!'];
  const BLOOM_MSGS  = parsing ? PARSE_MSGS : GEN_MSGS;
  const BloomLoading = () => !(loading || parsing) ? null : (
    <div className="fixed inset-0 z-[200] bg-[#0a2265]/90 backdrop-blur-sm flex flex-col items-center justify-center px-8">
      {/* 꽃 이모지 — 단계별 크기 펄스 */}
      <div
        key={bloomStage}
        className="text-[80px] mb-4 animate-bounce"
        style={{ animationDuration: '1.2s' }}
      >
        {BLOOM_EMOJIS[Math.min(bloomStage, 4)]}
      </div>

      {/* 단계 메시지 */}
      <p className="text-white text-base font-bold mb-1">
        {BLOOM_MSGS[Math.min(bloomStage, 4)]}
      </p>

      {/* 예상 잔여 시간 */}
      <p className="text-blue-200 text-xs mb-6">
        {bloomCountdown > 0 ? `약 ${bloomCountdown}초 남았어요` : '거의 다 됐어요 ✨'}
      </p>

      {/* 프로그레스 바 */}
      <div className="w-full max-w-xs bg-white/10 rounded-full h-2 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-violet-400 to-yellow-300 rounded-full transition-all duration-1000"
          style={{ width: `${Math.min(100, (bloomStage / 4) * 100)}%` }}
        />
      </div>

      {/* 꽃잎 단계 점 */}
      <div className="flex gap-2 mt-4">
        {BLOOM_EMOJIS.slice(0, 4).map((e, i) => (
          <span key={i} className={`text-sm transition-all duration-300 ${i <= bloomStage ? 'opacity-100 scale-125' : 'opacity-20'}`}>{e}</span>
        ))}
      </div>

      <p className="text-white/30 text-[10px] mt-6">AI가 유사 문제를 직접 설계하고 있어요</p>
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
  // 홈 — 학습 대시보드
  // ═══════════════════════════════════════
  if (mode === 'home') return (
    <div {...swipeProps} className="relative"><div className="min-h-screen bg-gradient-to-b from-violet-50 to-white pb-20">
      <BloomLoading />
      <div className="max-w-xl mx-auto px-4 pt-6">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-[#0a2265] to-[#1a3a8f] flex items-center justify-center shadow-md shadow-blue-200">
              <span className="text-white text-xs font-black">BL</span>
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-black text-gray-900">Bloom<span className="text-violet-600">Lens</span></span>
                <span className="text-[9px] font-bold text-[#0a2265]/50 bg-[#0a2265]/5 px-1.5 py-0.5 rounded tracking-wider">S-AID</span>
              </div>
              <div className="text-xs text-violet-500">Lv.{game.level} {levelTitle(game.level)}</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {game.streak > 0 && (
              <span className="text-xs text-orange-500 font-bold bg-orange-50 border border-orange-100 px-2 py-1 rounded-lg">🔥{game.streak}일</span>
            )}
          </div>
        </div>

        {/* 학습 현황 3칸 */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="bg-white shadow-sm rounded-xl p-3 text-center border border-gray-50">
            <div className="text-lg font-black text-violet-600">{game.totalSolved}</div>
            <div className="text-[10px] text-gray-400">푼 문제</div>
          </div>
          <div className="bg-white shadow-sm rounded-xl p-3 text-center border border-gray-50">
            <div className="text-lg font-black text-yellow-500">
              {game.totalSolved > 0 ? `${Math.round((game.totalCorrect / game.totalSolved) * 100)}%` : '-'}
            </div>
            <div className="text-[10px] text-gray-400">정답률</div>
          </div>
          <div className="bg-white shadow-sm rounded-xl p-3 text-center border border-gray-50">
            <div className="text-lg font-black text-orange-500">{game.streak > 0 ? `${game.streak}일` : '-'}</div>
            <div className="text-[10px] text-gray-400">연속</div>
          </div>
        </div>

        {/* XP 바 */}
        <div className="bg-white shadow-sm rounded-xl px-3 py-2.5 mb-4 border border-gray-50">
          <XpBar />
        </div>

        {/* 🎯 오늘 공부 시작 버튼 */}
        <button
          onClick={() => setShowGoalModal(true)}
          className="w-full py-4 rounded-2xl bg-gradient-to-r from-violet-600 to-violet-500 text-white font-bold text-[15px] shadow-lg shadow-violet-300/30 active:scale-[0.98] transition-transform mb-4"
        >
          🎯 오늘 뭘 공부할까?
          {(game.studyGrade || game.studySubject) && (
            <span className="ml-2 text-violet-200 text-xs font-normal">
              {[game.studyGrade, game.studySubject].filter(Boolean).join(' · ')}
            </span>
          )}
        </button>

        {/* 내 학습 맵 */}
        <div className="bg-white/80 backdrop-blur border border-gray-100 rounded-2xl p-4 mb-4 relative overflow-hidden">
          <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle, #7c3aed 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-gray-700">🗺️ 내 학습 맵</span>
              {(game.userKeywords?.length ?? 0) > 0 && (
                <span className="text-[10px] text-violet-400">{game.userKeywords.length}개 키워드</span>
              )}
            </div>
            {(game.userKeywords?.length ?? 0) === 0 ? (
              <div className="text-center py-5">
                <div className="text-3xl mb-2 opacity-30">🌱</div>
                <p className="text-xs text-gray-400 font-medium mb-0.5">아직 키워드가 없어요</p>
                <p className="text-[10px] text-gray-300">시험지를 스캔하면 자동으로 키워드가 쌓여요</p>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {game.userKeywords.map(kw => (
                  <button
                    key={kw}
                    onClick={() => {
                      // 키워드를 과목/단원으로 설정하고 바로 문제 생성
                      setHomeSubject(game.studySubject || kw);
                      setHomeUnit(kw);
                      setHomeGrade(game.studyGrade || '');
                      setShowGoalModal(false);
                      // generateFromGoal은 state 반영 후 실행해야 해서 setTimeout
                      setTimeout(() => {
                        const topic = kw;
                        setLoading(true); startBloomTimer(15);
                        fetch('/api/generate-by-topic', {
                          method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ grade: game.studyGrade || '', subject: game.studySubject || kw, topic, difficulty, count }),
                        }).then(r => r.json()).then(data => {
                          const all: QuizProblem[] = data.problems || [];
                          if (all.length > 0) {
                            setProblems(all); setCurrentIndex(0); setSelectedAnswer(null);
                            setShowExplanation(false); setScore({ correct: 0, total: 0 });
                            setQuizAnswers([]); setConsecutiveCorrect(0); setPreviewExpanded(null);
                            stopBloomTimer(); setMode('preview');
                          } else { stopBloomTimer(); alert('문제 생성에 실패했습니다.'); }
                        }).catch(() => { stopBloomTimer(); alert('오류'); })
                          .finally(() => setLoading(false));
                      }, 0);
                    }}
                    className="bg-violet-50 border border-violet-200 rounded-xl px-3 py-2 text-left hover:bg-violet-100 active:scale-95 transition-all"
                  >
                    <div className="text-xs font-bold text-violet-700">{kw}</div>
                    <div className="text-[10px] text-violet-400 mt-0.5">✨ 문제 만들기</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 보조 CTA */}
        <div className="flex gap-2">
          <button onClick={goScan}
            className="flex-1 py-3 rounded-xl bg-white border border-gray-200 text-gray-600 font-medium text-sm active:scale-[0.98] transition-transform shadow-sm">
            📷 시험지 스캔
          </button>
          <button onClick={() => { loadBank(); setMode('bank'); setActiveNav('quest'); }}
            className="flex-1 py-3 rounded-xl bg-white border border-gray-200 text-gray-600 font-medium text-sm active:scale-[0.98] transition-transform shadow-sm">
            📦 문제은행
          </button>
          <button onClick={() => { loadWrongNote(); setProfileTab('wrongnote'); setMode('profile'); setActiveNav('profile'); }}
            className="flex-1 py-3 rounded-xl bg-red-50 border border-red-100 text-red-500 font-medium text-sm active:scale-[0.98] transition-transform shadow-sm relative">
            ❌ 오답노트
          </button>
        </div>
      </div>
      <BottomNav />
      <LevelUpModal />
      <DotIndicator />

      {/* 바텀시트 — 오늘 공부 설정 */}
      {showGoalModal && (
        <div className="fixed inset-0 z-[150] flex items-end" onClick={() => setShowGoalModal(false)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div className="relative w-full bg-white rounded-t-3xl px-5 pt-4 pb-10 shadow-2xl max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            {/* 핸들 */}
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4" />
            <h2 className="text-base font-extrabold text-gray-900 mb-4">📚 오늘 뭘 공부할까요?</h2>

            {/* 학년/상황 */}
            <div className="mb-3">
              <label className="text-xs text-gray-500 font-medium mb-1.5 block">학년 / 상황</label>
              <input type="text" value={homeGrade} onChange={e => setHomeGrade(e.target.value)}
                placeholder="고2, 대학교 3학년, 정보처리기사..."
                className="w-full px-3 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-900 placeholder-gray-300 focus:outline-none focus:border-violet-400 focus:bg-white" />
              <div className="flex gap-1.5 mt-1.5 flex-wrap">
                {['고1', '고2', '고3', '대학교', '자격증'].map(g => (
                  <button key={g} onClick={() => setHomeGrade(g)}
                    className={`text-xs px-3 py-1 rounded-lg border transition-colors ${homeGrade === g ? 'bg-violet-600 text-white border-violet-600' : 'bg-gray-50 text-gray-500 border-gray-200'}`}>
                    {g}
                  </button>
                ))}
              </div>
            </div>

            {/* 과목/전공 */}
            <div className="mb-3">
              <label className="text-xs text-gray-500 font-medium mb-1.5 block">과목 / 전공</label>
              <input type="text" value={homeSubject} onChange={e => setHomeSubject(e.target.value)}
                placeholder="수학, 영어, 자료구조..."
                className="w-full px-3 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-900 placeholder-gray-300 focus:outline-none focus:border-violet-400 focus:bg-white" />
            </div>

            {/* 단원 (선택) */}
            <div className="mb-4">
              <label className="text-xs text-gray-500 font-medium mb-1.5 block">
                단원 <span className="text-gray-300 font-normal">— 없으면 전범위</span>
              </label>
              <input type="text" value={homeUnit} onChange={e => setHomeUnit(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && homeSubject.trim()) { generateFromGoal(); setShowGoalModal(false); } }}
                placeholder="이차함수, 트리, 관계형 데이터베이스..."
                className="w-full px-3 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-900 placeholder-gray-300 focus:outline-none focus:border-violet-400 focus:bg-white" />
            </div>

            {/* 난이도 + 문제수 */}
            <div className="flex gap-3 mb-4">
              <div className="flex-1">
                <label className="text-xs text-gray-500 font-medium mb-1.5 block">난이도</label>
                <div className="flex gap-1">
                  {[1,2,3].map(d => (
                    <button key={d} onClick={() => setDifficulty(d)}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors ${difficulty === d ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
                      {d===1?'하':d===2?'중':'상'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1">
                <label className="text-xs text-gray-500 font-medium mb-1.5 block">문제 수</label>
                <div className="flex gap-1">
                  {[3,5,10].map(n => (
                    <button key={n} onClick={() => setCount(n)}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors ${count === n ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button
              onClick={() => { generateFromGoal(); setShowGoalModal(false); }}
              disabled={!homeSubject.trim() || loading}
              className="w-full py-4 rounded-2xl bg-gradient-to-r from-violet-600 to-violet-500 text-white font-bold text-base shadow-lg shadow-violet-300/30 disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none active:scale-[0.98] transition-all"
            >
              🎯 문제 만들기
            </button>
          </div>
        </div>
      )}
    </div></div>
  );

  // ═══════════════════════════════════════
  // 스캔 화면 (촬영 전 안내 포함)
  // ═══════════════════════════════════════
  if (mode === 'scan') return (
    <div {...swipeProps} className="relative"><div className="min-h-screen bg-gradient-to-b from-violet-50 to-white pb-20">
      <BloomLoading />
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
      <BloomLoading />
      <div className="max-w-xl mx-auto px-4 py-6">
        <button onClick={goScan} className="text-violet-600 text-sm mb-3 flex items-center gap-1">← 다시 촬영</button>

        <div className="text-center mb-5">
          <div className="text-3xl mb-1">🎯</div>
          <h2 className="text-lg font-extrabold text-gray-900">{parseResult.problems.length}문제 발견!</h2>
          <p className="text-xs text-gray-500">{parseResult.overall_subject} · {parseResult.source_description}</p>
        </div>

        {/* 촬영 후 안내 */}
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 mb-3">
          <p className="text-xs text-green-600 leading-relaxed">✨ <strong>선택한 문제를 기반으로</strong> AI가 같은 개념, 다른 숫자의 유사 문제를 만들어요. 진짜 이해했는지 확인!</p>
        </div>

        {/* 키워드 추가 (AI 추천 + 직접 입력) */}
        {(() => {
          const aiKws = Array.from(new Set(parseResult.problems.flatMap(p => p.keywords || []))).filter(Boolean).slice(0, 8) as string[];
          const userKws = game.userKeywords ?? [];
          const addKw = (kw: string) => {
            setGame(prev => {
              const merged = Array.from(new Set([...(prev.userKeywords ?? []), kw]));
              const g = { ...prev, userKeywords: merged };
              saveGame(g);
              return g;
            });
          };
          return (
            <div className="bg-violet-50 border border-violet-200 rounded-xl p-3 mb-4">
              <p className="text-xs font-semibold text-violet-700 mb-2">🏷️ 내 학습 맵에 키워드 추가</p>
              {aiKws.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {aiKws.map(kw => (
                    <button key={kw} onClick={() => addKw(kw)}
                      className={`text-[11px] px-2.5 py-1 rounded-lg border transition-colors ${userKws.includes(kw) ? 'bg-violet-200 text-violet-700 border-violet-300' : 'bg-white text-violet-600 border-violet-200 hover:bg-violet-100 active:scale-95'}`}>
                      {userKws.includes(kw) ? '✓ ' : '＋ '}{kw}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <input type="text" value={parsedKeywordTag} onChange={e => setParsedKeywordTag(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && parsedKeywordTag.trim()) { addKw(parsedKeywordTag.trim()); setParsedKeywordTag(''); } }}
                  placeholder="직접 입력 후 엔터..."
                  className="flex-1 px-2.5 py-1.5 rounded-lg border border-violet-200 bg-white text-xs text-gray-900 placeholder-gray-300 focus:outline-none focus:border-violet-400" />
                <button onClick={() => { if (parsedKeywordTag.trim()) { addKw(parsedKeywordTag.trim()); setParsedKeywordTag(''); } }}
                  disabled={!parsedKeywordTag.trim()}
                  className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-bold disabled:bg-gray-200 disabled:text-gray-400">추가</button>
              </div>
            </div>
          );
        })()}

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
          {/* 상단 완성 배너 + 바로 풀기 CTA */}
          <div className="bg-gradient-to-r from-violet-600 to-violet-500 rounded-2xl p-4 mb-4 flex items-center justify-between shadow-lg shadow-violet-300/30">
            <div>
              <div className="text-white font-extrabold text-base">✅ {problems.length}개 완성!</div>
              <div className="text-violet-200 text-xs mt-0.5">지금 바로 풀어볼 수 있어요</div>
            </div>
            <button onClick={startQuizFromPreview}
              className="bg-white text-violet-600 font-bold text-sm px-4 py-2.5 rounded-xl shadow-sm active:scale-95 transition-transform">
              지금 풀기 ▶
            </button>
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

          {/* 하단 CTA */}
          <div className="space-y-2.5">
            <button onClick={startQuizFromPreview} className="w-full py-4 rounded-2xl bg-gradient-to-r from-violet-600 to-violet-500 text-white font-bold text-[15px] shadow-lg shadow-violet-300/30 active:scale-[0.98] transition-transform">
              ▶️ 지금 풀어보기
            </button>
            <div className="flex gap-2">
              <button onClick={() => { loadBank(); setMode('bank'); setActiveNav('quest'); }} className="flex-1 py-3 rounded-xl bg-violet-50 border border-violet-200 text-violet-600 font-medium text-sm active:scale-95 transition-transform">
                📦 문제은행
              </button>
              <button onClick={goScan} className="flex-1 py-3 rounded-xl bg-gray-50 border border-gray-200 text-gray-500 font-medium text-sm active:scale-95 transition-transform">
                📷 다시 스캔
              </button>
            </div>
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
                    className="mt-2 w-full py-2 rounded-lg bg-gray-50 text-gray-500 text-xs font-medium border border-gray-100">
                    {subject} 문제 보기 →
                  </button>
                </div>
              );
            })}

            {/* 필터된 문제 목록 — 1문제씩 */}
            {bankFilter.subject && bankProblems.length > 0 && (
              <div className="space-y-2">
                {bankProblems.map((p, idx) => {
                  const served = (p as QuizProblem & { times_served?: number }).times_served ?? 0;
                  const correct = (p as QuizProblem & { times_correct?: number }).times_correct ?? 0;
                  const accuracy = served > 0 ? Math.round((correct / served) * 100) : null;
                  return (
                    <div key={p.id || idx} className="bg-white shadow-sm rounded-2xl border border-gray-100 p-3.5">
                      <p className="text-xs text-gray-800 leading-relaxed line-clamp-2 mb-2.5">
                        <MathText text={p.question_text} />
                      </p>
                      <div className="flex items-center justify-between">
                        <div className="flex gap-1 flex-wrap">
                          {p.topic && <span className="px-1.5 py-0.5 bg-gray-100 text-gray-400 text-[10px] rounded">{p.topic}</span>}
                          <span className="px-1.5 py-0.5 bg-yellow-50 text-yellow-600 text-[10px] rounded border border-yellow-100">{diffLabels[p.difficulty || 2]}</span>
                          {accuracy !== null
                            ? <span className={`px-1.5 py-0.5 text-[10px] rounded ${accuracy >= 70 ? 'bg-green-50 text-green-500' : 'bg-red-50 text-red-400'}`}>
                                {accuracy}% ({served}회)
                              </span>
                            : <span className="text-[10px] text-gray-300">미풀이</span>
                          }
                        </div>
                        <button
                          onClick={() => startBankQuiz([p])}
                          className="ml-2 px-3 py-1.5 rounded-xl bg-violet-600 text-white text-xs font-bold active:scale-95 transition-transform flex-shrink-0">
                          풀기 ▶
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
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
  // 프로필 — 통계 + 오답노트 탭
  // ═══════════════════════════════════════
  if (mode === 'profile') return (
    <div {...swipeProps} className="relative"><div className="min-h-screen bg-gradient-to-b from-violet-50 to-white pb-20">
      <div className="max-w-xl mx-auto px-4 py-6">
        {/* 프로필 헤더 */}
        <div className="text-center mb-4">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-violet-600 to-violet-400 flex items-center justify-center text-2xl mx-auto mb-2">🧠</div>
          <h2 className="text-base font-extrabold text-gray-900">Lv.{game.level} {levelTitle(game.level)}</h2>
          <div className="mt-1"><XpBar /></div>
        </div>

        {/* 탭 */}
        <div className="flex bg-gray-100 rounded-xl p-1 mb-4">
          <button onClick={() => setProfileTab('stats')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${profileTab === 'stats' ? 'bg-white text-violet-600 shadow-sm font-semibold' : 'text-gray-500'}`}>
            📊 내 통계
          </button>
          <button onClick={() => { setProfileTab('wrongnote'); loadWrongNote(); }}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${profileTab === 'wrongnote' ? 'bg-white text-red-500 shadow-sm font-semibold' : 'text-gray-500'}`}>
            ❌ 오답노트 {wrongNoteProblems.length > 0 && <span className="ml-1 text-xs bg-red-100 text-red-500 px-1.5 py-0.5 rounded-full">{wrongNoteProblems.length}</span>}
          </button>
        </div>

        {/* ── 통계 탭 ── */}
        {profileTab === 'stats' && (
          <>
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

            {/* 일일 미션 */}
            <div className="bg-white shadow-sm border border-violet-100 rounded-2xl p-4 mb-4">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-bold text-violet-600">📋 오늘의 미션</span>
                <span className="text-xs text-gray-400">{(game.totalSolved >= 3 ? 1 : 0) + (game.totalSolved >= 1 ? 1 : 0) + (wrongNoteProblems.length > 0 ? 0 : 0)}/3</span>
              </div>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between"><span className={game.totalSolved >= 1 ? 'text-gray-400 line-through' : 'text-gray-700'}>{game.totalSolved >= 1 ? '✅' : '⬜'} 문제 1개 풀기</span><span className="text-violet-500">+10 QP</span></div>
                <div className="flex justify-between"><span className={game.totalSolved >= 3 ? 'text-gray-400 line-through' : 'text-gray-700'}>{game.totalSolved >= 3 ? '✅' : '⬜'} 문제 3개 풀기</span><span className="text-violet-500">+30 QP</span></div>
                <div className="flex justify-between"><span className="text-gray-700">⬜ 오답 특훈 1회</span><span className="text-violet-500">+40 QP</span></div>
              </div>
            </div>

            {/* 탐험한 과목 */}
            {game.categories.length > 0 && (
              <div className="bg-white shadow-sm border border-gray-100 rounded-2xl p-4 mb-4">
                <div className="text-xs font-bold text-gray-900 mb-2">🏷 탐험한 과목</div>
                <div className="flex gap-1.5 flex-wrap">{game.categories.map(c => <span key={c} className="px-2.5 py-1 bg-violet-100 text-violet-600 text-xs rounded-lg">{c}</span>)}</div>
              </div>
            )}

            {/* 뱃지 */}
            <div className="bg-white shadow-sm border border-gray-100 rounded-2xl p-4">
              <div className="text-xs font-bold text-gray-900 mb-2">🏅 뱃지 (준비 중)</div>
              <div className="flex gap-2">
                {[1,2,3,4].map(i => <div key={i} className="w-10 h-10 rounded-xl bg-gray-100 border border-dashed border-gray-200 flex items-center justify-center text-sm">🔒</div>)}
              </div>
              <p className="text-[10px] text-gray-400 mt-2">과목별 정답률 80% + 20문제 이상 풀면 해금</p>
            </div>
          </>
        )}

        {/* ── 오답노트 탭 ── */}
        {profileTab === 'wrongnote' && (
          <>
            {wrongNoteLoading ? (
              <div className="text-center py-12">
                <span className="inline-block animate-spin text-2xl">⏳</span>
                <p className="text-xs text-gray-400 mt-2">오답 불러오는 중...</p>
              </div>
            ) : wrongNoteProblems.length === 0 ? (
              <div className="text-center py-16">
                <div className="text-5xl mb-3 opacity-30">🎉</div>
                <p className="text-sm font-bold text-gray-500 mb-1">오답이 없어요!</p>
                <p className="text-xs text-gray-400">문제를 풀면 틀린 것들이 여기 쌓여요</p>
              </div>
            ) : (
              <>
                {/* 요약 + 전체 특훈 */}
                <div className="bg-red-50 border border-red-100 rounded-2xl p-4 mb-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-extrabold text-red-600">❌ {wrongNoteProblems.length}문제 틀렸어요</div>
                      <div className="text-xs text-red-400 mt-0.5">
                        {Object.entries(wrongNoteSubjects).slice(0, 3).map(([s, n]) => `${s} ${n}개`).join(' · ')}
                      </div>
                    </div>
                    <button
                      onClick={() => startBankQuiz(wrongNoteProblems.slice(0, 10) as QuizProblem[])}
                      className="px-4 py-2 bg-red-500 text-white text-xs font-bold rounded-xl active:scale-95 transition-transform">
                      🔥 전체 특훈
                    </button>
                  </div>
                </div>

                {/* 과목별 요약 칩 */}
                {Object.keys(wrongNoteSubjects).length > 1 && (
                  <div className="flex gap-2 mb-4 flex-wrap">
                    {Object.entries(wrongNoteSubjects).map(([subject, cnt]) => (
                      <div key={subject} className="flex items-center gap-1 bg-white border border-red-100 rounded-xl px-3 py-1.5">
                        <span className="text-xs font-bold text-gray-700">{subject}</span>
                        <span className="text-xs text-red-400">{cnt}개</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* 오답 목록 */}
                <div className="space-y-2">
                  {wrongNoteProblems.map((p, idx) => (
                    <div key={idx} className="bg-white shadow-sm rounded-2xl border border-red-50 p-3.5">
                      <p className="text-xs text-gray-800 leading-relaxed line-clamp-2 mb-2">
                        <MathText text={p.question_text} />
                      </p>
                      {/* 내 답 vs 정답 */}
                      {p.student_answer && (
                        <div className="flex gap-2 mb-2">
                          <span className="text-[10px] bg-red-50 text-red-400 px-2 py-0.5 rounded-lg">내 답: {p.student_answer}</span>
                          <span className="text-[10px] bg-green-50 text-green-500 px-2 py-0.5 rounded-lg">정답: {p.correct_answer}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <div className="flex gap-1 flex-wrap">
                          {p.subject && <span className="px-1.5 py-0.5 bg-gray-100 text-gray-400 text-[10px] rounded">{p.subject}</span>}
                          {p.topic && <span className="px-1.5 py-0.5 bg-gray-100 text-gray-400 text-[10px] rounded">{p.topic}</span>}
                          {(p.wrong_count ?? 0) > 1 && (
                            <span className="px-1.5 py-0.5 bg-red-50 text-red-400 text-[10px] rounded">{p.wrong_count}번 틀림</span>
                          )}
                        </div>
                        <button
                          onClick={() => startBankQuiz([p as QuizProblem])}
                          className="ml-2 px-3 py-1.5 rounded-xl bg-red-500 text-white text-xs font-bold active:scale-95 transition-transform flex-shrink-0">
                          다시 풀기
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {/* ── 설정 섹션 (항상 표시) ── */}
        <div className="mt-6 bg-white shadow-sm border border-gray-100 rounded-2xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-50">
            <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">설정 / MVP</span>
          </div>
          <button
            onClick={async () => {
              if (!confirm('로그아웃 하시겠어요?')) return;
              await signOut();
              window.location.reload();
            }}
            className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-gray-50 active:bg-gray-100 transition-colors border-b border-gray-50">
            <span className="text-sm text-gray-700">🚪 로그아웃</span>
            <span className="text-xs text-gray-300">→</span>
          </button>
          <button
            onClick={async () => {
              if (!confirm('⚠️ 모든 학습 데이터(문제은행 + 퀴즈 기록)를 삭제합니다.\n정말 초기화하시겠어요?')) return;
              try {
                const res = await fetch('/api/reset-db', { method: 'DELETE' });
                const data = await res.json();
                if (data.ok) {
                  // 로컬 게임 상태도 리셋
                  localStorage.removeItem('qt_game');
                  alert('초기화 완료! 앱을 다시 시작합니다.');
                  window.location.reload();
                } else {
                  alert('초기화 실패: ' + (data.error || '알 수 없는 오류'));
                }
              } catch { alert('초기화 중 오류가 발생했습니다.'); }
            }}
            className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-red-50 active:bg-red-100 transition-colors">
            <span className="text-sm text-red-500">🗑️ 데이터 전체 초기화</span>
            <span className="text-xs text-red-300">삭제 불가</span>
          </button>
        </div>
      </div>
      <BottomNav />
      <DotIndicator />
    </div></div>
  );

  return null;
}

