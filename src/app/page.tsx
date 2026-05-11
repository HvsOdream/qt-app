'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';

// ═══════════════════════════════════════════════
// 타입
// ═══════════════════════════════════════════════
type View = 'loading' | 'home' | 'category' | 'problem-detail' | 'scan' | 'confirm' | 'categorize' | 'preview' | 'quiz' | 'result';
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
  user_note: string | null;
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
  explanation: string | null;
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
  const [selectedCategoryKey, setSelectedCategoryKey] = useState<string>('');
  const [selectedProblemId, setSelectedProblemId] = useState<string>('');
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

  // ─── 카테고리 일괄 입력 (categorize view) ───
  const [categorySubject, setCategorySubject] = useState('');
  const [categoryTopic, setCategoryTopic]     = useState('');

  // ─── 미리보기 (생성된 유사문제) ───
  const [previewItems, setPreviewItems] = useState<WrongNoteItem[]>([]);

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
      // - 기본값: 모든 항목 unchecked → 사용자가 틀린 것만 직접 선택
      // - subject/topic은 자동 추정값을 placeholder로만 노출, 입력값은 빈 문자열
      const items: ConfirmItem[] = data.problems.map((p: ParsedProblem) => ({
        problem: p,
        subject: '',
        topic: '',
        selected: false,
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
  // 공통 카테고리(categorySubject/Topic)를 모든 선택 항목에 일괄 적용해 저장
  // generateAfter=true이면 저장 직후 유사문제 생성 → preview view로 이동
  const handleSaveToWrongNote = async (generateAfter: boolean = false) => {
    if (!user) return;
    const toSave = confirmItems.filter(ci => ci.selected && ci.problem.correct_answer);
    if (!toSave.length) { alert('저장할 문제를 선택해주세요.'); return; }

    setSaving(true);
    try {
      const items = toSave.map(ci => ({
        subject: categorySubject.trim() || null,
        topic: categoryTopic.trim() || null,
        question_text: ci.problem.question_text,
        choices: ci.problem.choices || [],
        question_type: ci.problem.question_type || 'multiple_choice',
        correct_answer: ci.problem.correct_answer!,
        explanation: ci.problem.explanation || null,
        source: 'scan',
      }));
      const res = await fetch('/api/wrong-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: user.id, items }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const savedItems: WrongNoteItem[] = data.saved || [];

      // 스캔 관련 임시 상태 초기화
      setImageFile(null); setImagePreview(null); setParseResult(null); setConfirmItems([]);
      setCategorySubject(''); setCategoryTopic('');

      if (generateAfter && savedItems.length > 0) {
        // 저장된 항목으로 즉시 유사문제 생성 → preview view
        setGenerating(true);
        try {
          const countPer = Math.max(1, Math.ceil(3 / savedItems.length));
          const responses = await Promise.all(
            savedItems.map(item =>
              fetch('/api/generate-similar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ originalItem: item, device_id: user.id, count: countPer }),
              }).then(r => r.json()).catch(() => ({ items: [] }))
            )
          );
          const allGenerated: WrongNoteItem[] = responses.flatMap(r => r.items || []);
          if (allGenerated.length > 0) {
            setPreviewItems(allGenerated);
            setView('preview');
          } else {
            alert('저장은 됐는데 유사문제 생성은 실패했어요.');
            setView('home');
          }
        } finally { setGenerating(false); }
      } else {
        setView('home');
      }
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

  // ─── 유사문제 생성 (병렬) → 미리보기로 이동 ───
  const handleGenerateSimilar = async () => {
    if (!user || selectedIds.size === 0) return;
    const selected = wrongNote.filter(item => selectedIds.has(item.id));
    setGenerating(true);
    try {
      const countPer = Math.max(1, Math.ceil(3 / selected.length));
      const responses = await Promise.all(
        selected.map(item =>
          fetch('/api/generate-similar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ originalItem: item, device_id: user.id, count: countPer }),
          }).then(r => r.json()).catch(() => ({ items: [] }))
        )
      );
      const allGenerated: WrongNoteItem[] = responses.flatMap(r => r.items || []);
      if (allGenerated.length > 0) {
        setPreviewItems(allGenerated);
        setView('preview');
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
  // 자식 항목 풀이 시작 (원본 카드 클릭)
  // ════════════════════════════════════════
  const childrenOf = useCallback((parentId: string) =>
    wrongNote.filter(c => c.parent_id === parentId), [wrongNote]);

  const handleStartChildren = async (parent: WrongNoteItem) => {
    const children = childrenOf(parent.id);
    if (children.length > 0) {
      // mastered 안 된 자식 우선, 없으면 전체
      const remaining = children.filter(c => !c.mastered);
      startQuiz(remaining.length > 0 ? remaining : children, 'generated');
      return;
    }
    // 자식 없으면 즉시 유사문제 생성 → preview
    if (!user) return;
    setGenerating(true);
    try {
      const res = await fetch('/api/generate-similar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ originalItem: parent, device_id: user.id, count: 3 }),
      });
      const data = await res.json();
      const items: WrongNoteItem[] = data.items || [];
      if (items.length > 0) {
        setPreviewItems(items);
        setView('preview');
      } else {
        alert('유사문제 생성에 실패했습니다.');
      }
    } catch {
      alert('유사문제 생성 오류');
    } finally { setGenerating(false); }
  };

  // ════════════════════════════════════════
  // 필터된 오답노트 (원본만 — source==='scan')
  // ════════════════════════════════════════
  const originals = wrongNote.filter(i => i.source === 'scan');

  // 부모 mastered 판정
  const isParentDone = (parent: WrongNoteItem): boolean => {
    if (parent.mastered) return true;
    const kids = wrongNote.filter(c => c.parent_id === parent.id);
    return kids.length > 0 && kids.every(c => c.mastered);
  };

  // ─── 카테고리 그룹핑 (과목+단원 조합 = 1 폴더) ───
  const MISC_KEY = '__misc__';
  const categoryKeyOf = (item: WrongNoteItem): string => {
    const s = (item.subject || '').trim();
    const t = (item.topic || '').trim();
    if (!s && !t) return MISC_KEY;
    return `${s}§${t}`;
  };
  const labelOf = (key: string): { subject: string; topic: string; label: string } => {
    if (key === MISC_KEY) return { subject: '', topic: '', label: '미분류' };
    const [s, t] = key.split('§');
    return { subject: s, topic: t, label: s + (t ? ` · ${t}` : '') };
  };

  const categories = (() => {
    const map = new Map<string, WrongNoteItem[]>();
    originals.forEach(it => {
      const k = categoryKeyOf(it);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(it);
    });
    return Array.from(map.entries()).map(([key, items]) => {
      const total = items.length;
      const done = items.filter(isParentDone).length;
      return { key, items, total, done, ...labelOf(key) };
    }).sort((a, b) => {
      // 미분류는 맨 아래로
      if (a.key === MISC_KEY) return 1;
      if (b.key === MISC_KEY) return -1;
      return a.label.localeCompare(b.label, 'ko');
    });
  })();

  // 학습중/완료 탭 카운트는 폴더 단위
  const activeCount   = categories.filter(c => c.done < c.total).length;
  const masteredCount = categories.filter(c => c.done === c.total).length;

  const filteredCategories = categories.filter(c => {
    const allDone = c.done === c.total;
    if (homeTab === 'active' && allDone) return false;
    if (homeTab === 'mastered' && !allDone) return false;
    return true;
  });

  // 선택된 카테고리의 원본 문제 목록 (category view용)
  const itemsOfSelectedCategory = originals.filter(i => categoryKeyOf(i) === selectedCategoryKey);

  // ─── 분류 변경 핸들러 ───
  const handleChangeCategory = async (item: WrongNoteItem) => {
    const newSubject = window.prompt('과목을 입력해줘 (예: ADsP, 수학)', item.subject || '');
    if (newSubject === null) return;
    const newTopic = window.prompt('단원을 입력해줘 (예: 데이터 이해)', item.topic || '');
    if (newTopic === null) return;
    try {
      const res = await fetch(`/api/wrong-note/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: newSubject, topic: newTopic }),
      });
      if (!res.ok) throw new Error('분류 변경 실패');
      // 카테고리가 바뀌면 selectedCategoryKey도 새 키로 갱신
      const newKey = (!newSubject.trim() && !newTopic.trim())
        ? MISC_KEY
        : `${newSubject.trim()}§${newTopic.trim()}`;
      if (view === 'category') setSelectedCategoryKey(newKey);
      await loadWrongNote();
    } catch { alert('분류 변경 중 오류가 발생했습니다.'); }
  };

  // ─── 유사문제 추가 생성 (problem-detail에서 호출) ───
  const handleGenerateMore = async (parent: WrongNoteItem) => {
    if (!user) return;
    setGenerating(true);
    try {
      const res = await fetch('/api/generate-similar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ originalItem: parent, device_id: user.id, count: 3 }),
      });
      const data = await res.json();
      const items: WrongNoteItem[] = data.items || [];
      if (items.length > 0) {
        setPreviewItems(items);
        setView('preview');
        await loadWrongNote();
      } else {
        alert('유사문제 생성에 실패했습니다.');
      }
    } catch { alert('유사문제 생성 오류'); }
    finally { setGenerating(false); }
  };

  // ─── 사용자 메모 저장 (blur 시 자동) ───
  const [noteSaveStatus, setNoteSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const handleSaveNote = async (id: string, note: string) => {
    setNoteSaveStatus('saving');
    try {
      const res = await fetch(`/api/wrong-note/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_note: note }),
      });
      if (!res.ok) throw new Error();
      // 로컬 state 즉시 갱신 (loadWrongNote 안 부르고 빠르게)
      setWrongNote(prev => prev.map(it => it.id === id ? { ...it, user_note: note } : it));
      setNoteSaveStatus('saved');
      setTimeout(() => setNoteSaveStatus('idle'), 2000);
    } catch {
      setNoteSaveStatus('idle');
      alert('메모 저장 실패');
    }
  };

  // ─── 항목 삭제 핸들러 (자식 cascade) ───
  const handleDelete = async (item: WrongNoteItem) => {
    if (!window.confirm('이 원본 문제와 유사문제까지 모두 삭제할까요?\n되돌릴 수 없습니다.')) return;
    try {
      const res = await fetch(`/api/wrong-note/${item.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('삭제 실패');
      await loadWrongNote();
      // 폴더가 비면 홈으로 복귀
      if (view === 'category') {
        const remain = wrongNote.filter(i =>
          i.source === 'scan' && i.id !== item.id && categoryKeyOf(i) === selectedCategoryKey
        );
        if (remain.length === 0) setView('home');
      }
    } catch { alert('삭제 중 오류가 발생했습니다.'); }
  };

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

        {/* 카테고리 폴더 목록 */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 pb-36">
          {noteLoading ? (
            <div className="text-center py-16 text-slate-400 text-sm">불러오는 중...</div>
          ) : filteredCategories.length === 0 ? (
            <div className="text-center py-16 space-y-3">
              <div className="text-4xl">{homeTab === 'mastered' ? '🏆' : '📖'}</div>
              <p className="text-slate-500 text-sm">
                {homeTab === 'mastered'
                  ? '아직 완료한 카테고리가 없어요.'
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
            <>
            {filteredCategories.map(cat => {
              const allDone = cat.done === cat.total;
              const isMisc = cat.key === MISC_KEY;
              return (
                <div
                  key={cat.key}
                  onClick={() => { setSelectedCategoryKey(cat.key); setView('category'); }}
                  className={`bg-white rounded-xl border-2 p-4 cursor-pointer transition select-none active:scale-[0.99] flex items-center gap-3 ${
                    allDone ? 'border-emerald-200' : isMisc ? 'border-amber-200' : 'border-slate-100 hover:border-[#1B3F8B]/40'
                  }`}
                >
                  <div className="text-2xl flex-shrink-0">{isMisc ? '⚠️' : allDone ? '🏆' : '📁'}</div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-800 truncate">{cat.label}</p>
                    <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                      <span>{cat.total}문제</span>
                      {cat.done > 0 && <><span className="text-slate-300">·</span><span className="text-emerald-600 font-medium">{cat.done}완료</span></>}
                      {isMisc && <><span className="text-slate-300">·</span><span className="text-amber-600 font-medium">분류 필요</span></>}
                    </div>
                  </div>
                  <svg className="w-4 h-4 text-slate-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
                  </svg>
                </div>
              );
            })}
            {/* 새 시험지 스캔 카드 (목록 맨 아래, 점선) */}
            <div
              onClick={() => { setImageFile(null); setImagePreview(null); setParseResult(null); setView('scan'); }}
              className="bg-white rounded-xl border-2 border-dashed border-slate-300 p-4 cursor-pointer transition select-none active:scale-[0.99] flex items-center gap-3 hover:border-[#1B3F8B] hover:bg-[#1B3F8B]/5"
            >
              <div className="text-2xl flex-shrink-0">📷</div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-slate-700">새 시험지 스캔하기</p>
                <p className="text-xs text-slate-400 mt-0.5">사진을 찍으면 AI가 문제를 정리해줘요</p>
              </div>
              <span className="text-slate-300 text-xl flex-shrink-0">+</span>
            </div>
            </>
          )}
        </div>

        {/* FAB: 시험지 스캔 (Extended) */}
        <div className="fixed bottom-6 right-4 z-30">
          <button
            onClick={() => { setImageFile(null); setImagePreview(null); setParseResult(null); setView('scan'); }}
            className="bg-[#1B3F8B] text-white rounded-full shadow-lg pl-4 pr-5 py-3 flex items-center gap-2 text-sm font-semibold hover:bg-[#163272] transition active:scale-95"
            title="시험지 스캔"
          >
            <span className="text-lg">📷</span>
            <span>시험지 스캔</span>
          </button>
        </div>

        {/* 생성 중 오버레이 */}
        {generating && (
          <div className="fixed inset-0 bg-slate-900/30 flex items-center justify-center z-40">
            <div className="bg-white rounded-xl px-6 py-4 shadow-lg text-sm text-slate-700">🧠 유사문제 만드는 중...</div>
          </div>
        )}
      </div>
    );
  }

  // ─── 카테고리 안 문제 목록 ───
  if (view === 'category') {
    const meta = labelOf(selectedCategoryKey);
    const items = itemsOfSelectedCategory;
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col max-w-lg mx-auto">
        {/* 헤더 */}
        <div className="bg-white border-b border-slate-100 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
          <button onClick={() => setView('home')} className="text-slate-400 hover:text-slate-600 transition">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/>
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-slate-800 truncate">{meta.label}</h1>
            <p className="text-xs text-slate-400">{items.length}문제</p>
          </div>
        </div>

        {/* 문제 카드 목록 */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 pb-24">
          {items.length === 0 ? (
            <div className="text-center py-16 text-sm text-slate-400">이 카테고리에 문제가 없어요.</div>
          ) : items.map(item => {
            const kids = childrenOf(item.id);
            const kidMastered = kids.filter(c => c.mastered).length;
            const done = isParentDone(item);
            const hasKids = kids.length > 0;
            return (
              <div
                key={item.id}
                className={`bg-white rounded-xl border-2 p-4 transition select-none ${
                  done ? 'border-emerald-200' : 'border-slate-100'
                }`}
              >
                <div
                  onClick={() => { setSelectedProblemId(item.id); setView('problem-detail'); }}
                  className="cursor-pointer active:scale-[0.99]"
                >
                  <p className="text-sm text-slate-700 line-clamp-2 leading-relaxed mb-2">
                    <MathText text={item.question_text} />
                  </p>
                  <div className="flex items-center justify-between gap-2">
                    {hasKids ? (
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-slate-500">유사문제 {kids.length}개</span>
                        <span className="text-slate-300">·</span>
                        <span className="text-emerald-600 font-medium">{kidMastered}/{kids.length} 풀음</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-xs text-amber-600">
                        <span>🧠</span>
                        <span className="font-medium">아직 유사문제 없음</span>
                      </div>
                    )}
                    {done ? <span className="text-lg">🏆</span> : (
                      <svg className="w-4 h-4 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
                      </svg>
                    )}
                  </div>
                </div>
                {/* 카드 하단 관리 액션 */}
                <div className="flex items-center justify-end gap-3 mt-3 pt-3 border-t border-slate-100">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleChangeCategory(item); }}
                    className="text-xs text-slate-500 hover:text-[#1B3F8B] transition"
                  >
                    ✏️ 분류 변경
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(item); }}
                    className="text-xs text-slate-400 hover:text-red-500 transition"
                  >
                    🗑️ 삭제
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* 생성 중 오버레이 */}
        {generating && (
          <div className="fixed inset-0 bg-slate-900/30 flex items-center justify-center z-40">
            <div className="bg-white rounded-xl px-6 py-4 shadow-lg text-sm text-slate-700">🧠 유사문제 만드는 중...</div>
          </div>
        )}
      </div>
    );
  }

  // ─── 문제 상세 (학습 허브) ───
  if (view === 'problem-detail') {
    const item = wrongNote.find(i => i.id === selectedProblemId);
    if (!item) {
      // 데이터 사라진 경우 안전 복귀
      setView('category');
      return null;
    }
    const kids = childrenOf(item.id);
    const remaining = kids.filter(c => !c.mastered);
    const kidMastered = kids.filter(c => c.mastered).length;
    const done = isParentDone(item);
    const correctIdx = parseInt(normalizeAnswer(item.correct_answer) || '0', 10);
    const meta = labelOf(categoryKeyOf(item));

    return (
      <div className="min-h-screen bg-slate-50 flex flex-col max-w-lg mx-auto">
        {/* 헤더 */}
        <div className="bg-white border-b border-slate-100 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
          <button onClick={() => setView('category')} className="text-slate-400 hover:text-slate-600 transition">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/>
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-slate-400">📁 {meta.label}</p>
            <h1 className="font-bold text-slate-800 text-sm">학습 허브</h1>
          </div>
          {done && <span className="text-2xl">🏆</span>}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 pb-32">
          {/* 원본 문제 카드 */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs">
              <span className="bg-[#1B3F8B] text-white rounded-full px-2.5 py-0.5 font-semibold">원본</span>
              <span className="text-slate-400">처음 틀린 문제</span>
            </div>
            <p className="text-sm text-slate-800 leading-relaxed">
              <MathText text={item.question_text} />
            </p>
            {item.choices && item.choices.length > 0 && (
              <div className="space-y-1.5">
                {item.choices.map((c, idx) => {
                  const isCorrect = (idx + 1) === correctIdx;
                  return (
                    <div
                      key={idx}
                      className={`text-sm rounded-lg px-3 py-2 border ${
                        isCorrect
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-800 font-medium'
                          : 'bg-slate-50 border-slate-100 text-slate-600'
                      }`}
                    >
                      {isCorrect && <span className="mr-1">✅</span>}
                      <MathText text={c} />
                    </div>
                  );
                })}
              </div>
            )}
            {item.question_type !== 'multiple_choice' && item.correct_answer && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-sm text-emerald-800">
                <span className="font-semibold mr-1">✅ 정답:</span>
                <MathText text={item.correct_answer} />
              </div>
            )}
            {item.explanation && (
              <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                <p className="text-xs text-[#1B3F8B] font-semibold mb-1">💡 해설</p>
                <p className="text-sm text-slate-700 leading-relaxed">
                  <MathText text={item.explanation} />
                </p>
              </div>
            )}
          </div>

          {/* 내 메모 (사용자 해설) */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-400 font-medium">📝 내 메모 / 해설</p>
              <span className={`text-xs transition ${
                noteSaveStatus === 'saving' ? 'text-slate-400' :
                noteSaveStatus === 'saved' ? 'text-emerald-500' : 'opacity-0'
              }`}>
                {noteSaveStatus === 'saving' ? '저장 중...' : noteSaveStatus === 'saved' ? '✓ 저장됨' : ''}
              </span>
            </div>
            <textarea
              key={item.id}
              defaultValue={item.user_note || ''}
              placeholder="왜 틀렸는지, 어떻게 풀어야 하는지 적어두면 다시 볼 때 도움돼요."
              onBlur={(e) => {
                const newNote = e.target.value;
                if (newNote !== (item.user_note || '')) {
                  handleSaveNote(item.id, newNote);
                }
              }}
              rows={3}
              className="w-full text-sm text-slate-700 leading-relaxed border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-[#1B3F8B] transition resize-none"
            />
          </div>

          {/* 유사문제 섹션 */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-400">유사문제</p>
                <p className="text-sm font-semibold text-slate-700">
                  {kids.length === 0 ? '아직 없음' : `${kids.length}개 · ${kidMastered}/${kids.length} 풀음`}
                </p>
              </div>
              {kids.length > 0 && (
                <div className="flex items-center gap-1">
                  {Array.from({ length: kids.length }).map((_, i) => (
                    <div
                      key={i}
                      className={`w-2.5 h-2.5 rounded-full ${
                        i < kidMastered ? 'bg-emerald-400' : 'bg-slate-200'
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* 액션 버튼들 */}
            {kids.length === 0 ? (
              <button
                onClick={() => handleGenerateMore(item)}
                disabled={generating}
                className="w-full bg-[#1B3F8B] text-white rounded-xl py-3 text-sm font-bold hover:bg-[#163272] transition disabled:opacity-60"
              >
                {generating ? '🧠 만드는 중...' : '🧠 유사문제 3개 만들기'}
              </button>
            ) : (
              <div className="space-y-2">
                {remaining.length > 0 && (
                  <button
                    onClick={() => startQuiz(remaining, 'generated')}
                    className="w-full bg-[#1B3F8B] text-white rounded-xl py-3 text-sm font-bold hover:bg-[#163272] transition"
                  >
                    ▶️ 안 풀어본 {remaining.length}개 풀기
                  </button>
                )}
                {remaining.length === 0 && kids.length > 0 && (
                  <button
                    onClick={() => startQuiz(kids, 'generated')}
                    className="w-full bg-emerald-600 text-white rounded-xl py-3 text-sm font-bold hover:bg-emerald-700 transition"
                  >
                    ♻️ 모두 풀었어! 다시 풀기
                  </button>
                )}
                <button
                  onClick={() => handleGenerateMore(item)}
                  disabled={generating}
                  className="w-full bg-white border border-slate-200 text-slate-600 rounded-xl py-2.5 text-sm font-medium hover:bg-slate-50 transition disabled:opacity-60"
                >
                  {generating ? '만드는 중...' : '🧠 유사문제 3개 더 만들기'}
                </button>
              </div>
            )}
          </div>

          {/* 관리 액션 (분류 변경만 — 삭제는 폴더 안에서) */}
          <div className="flex items-center justify-center pt-2">
            <button
              onClick={() => handleChangeCategory(item)}
              className="text-xs text-slate-500 hover:text-[#1B3F8B] transition"
            >
              ✏️ 분류 변경
            </button>
          </div>
        </div>

        {/* 생성 중 오버레이 */}
        {generating && (
          <div className="fixed inset-0 bg-slate-900/30 flex items-center justify-center z-40">
            <div className="bg-white rounded-xl px-6 py-4 shadow-lg text-sm text-slate-700">🧠 유사문제 만드는 중...</div>
          </div>
        )}
      </div>
    );
  }

  // ─── 스캔 ───
  if (view === 'scan') {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col max-w-lg mx-auto relative">
        {/* 풀스크린 분석 중 오버레이 */}
        {parsing && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-6">
            <div className="bg-white rounded-2xl px-6 py-8 max-w-sm w-full text-center space-y-4 shadow-2xl">
              <div className="flex justify-center">
                <svg className="animate-spin w-12 h-12 text-[#1B3F8B]" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              </div>
              <div>
                <p className="text-base font-bold text-slate-800 mb-1">🤖 AI가 문제를 분석하고 있어요</p>
                <p className="text-xs text-slate-500">10~20초 정도 걸려요. 잠깐만 기다려주세요.</p>
              </div>
              <div className="text-xs text-slate-400 space-y-1.5 text-left bg-slate-50 rounded-lg px-4 py-3">
                <p>📖 시험지 글자 인식</p>
                <p>🎯 정답 추론</p>
                <p>💡 해설 생성</p>
                <p>🏷️ 과목·단원 분류</p>
              </div>
            </div>
          </div>
        )}

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
          {/* 안내 + 전체 선택/해제 토글 */}
          <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex items-start justify-between gap-3">
            <div className="flex-1">
              <p className="text-xs text-[#1B3F8B] font-semibold mb-0.5">틀린 문제만 골라줘</p>
              <p className="text-xs text-slate-500">단원은 다음 단계에서 한 번에 입력해요</p>
            </div>
            {(() => {
              const allSelected = confirmItems.length > 0 && confirmItems.every(c => c.selected);
              return (
                <button
                  onClick={() => setConfirmItems(prev => prev.map(c => ({ ...c, selected: !allSelected })))}
                  className="text-xs font-medium text-[#1B3F8B] bg-white border border-[#1B3F8B]/30 rounded-lg px-3 py-1.5 hover:bg-[#1B3F8B] hover:text-white transition flex-shrink-0"
                >
                  {allSelected ? '전체 해제' : '전체 선택'}
                </button>
              );
            })()}
          </div>

          {confirmItems.map((ci, idx) => (
            <div
              key={idx}
              onClick={() => setConfirmItems(prev => prev.map((c, i) => i === idx ? { ...c, selected: !c.selected } : c))}
              className={`bg-white rounded-xl border-2 p-4 transition cursor-pointer ${
                ci.selected ? 'border-[#1B3F8B]' : 'border-slate-100 opacity-60'
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`mt-0.5 w-5 h-5 rounded-md border-2 flex-shrink-0 flex items-center justify-center transition ${
                    ci.selected ? 'bg-[#1B3F8B] border-[#1B3F8B]' : 'border-slate-300'
                  }`}
                >
                  {ci.selected && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/></svg>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-700 leading-relaxed">
                    <MathText text={ci.problem.question_text} />
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto bg-white border-t border-slate-100 px-4 py-3 z-20">
          <p className="text-xs text-slate-400 text-center mb-2">
            {confirmItems.filter(c => c.selected).length}개 선택됨 · 다음 단계에서 단원을 알려주세요
          </p>
          <button
            onClick={() => {
              // 자동 추정값을 categorize 화면 입력란 기본값으로 미리 채워둠
              const suggested = parseResult?.overall_subject || '';
              setCategorySubject(prev => prev || suggested);
              setCategoryTopic(prev => prev);
              setView('categorize');
            }}
            disabled={confirmItems.filter(c => c.selected).length === 0}
            className="w-full bg-[#1B3F8B] text-white rounded-xl py-4 text-base font-bold hover:bg-[#163272] transition disabled:opacity-60"
          >
            다음 →
          </button>
        </div>
      </div>
    );
  }

  // ─── 카테고리 일괄 입력 ───
  if (view === 'categorize') {
    const selectedCount = confirmItems.filter(c => c.selected).length;
    const selectedItems = confirmItems.filter(c => c.selected);
    const suggestedSubject = parseResult?.overall_subject || '';
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col max-w-lg mx-auto">
        <div className="bg-white border-b border-slate-100 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
          <button onClick={() => setView('confirm')} className="text-slate-400 hover:text-slate-600 transition">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/>
            </svg>
          </button>
          <div className="flex-1">
            <h1 className="font-bold text-slate-800">단원 입력</h1>
            <p className="text-xs text-slate-400">{selectedCount}개 문제에 일괄 적용돼요</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 pb-32">
          {/* 선택된 문제 미리보기 */}
          <div className="space-y-2">
            <p className="text-xs text-slate-400 font-medium">저장될 문제 ({selectedCount}개)</p>
            {selectedItems.map((ci, i) => (
              <div key={i} className="bg-white rounded-lg border border-slate-100 px-3 py-2 text-xs text-slate-600 line-clamp-2">
                <span className="text-slate-400 mr-1">#{i+1}</span>
                <MathText text={ci.problem.question_text} />
              </div>
            ))}
          </div>

          {/* 자동 추정 칩 */}
          {suggestedSubject && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-slate-400">추천:</span>
              <button
                onClick={() => setCategorySubject(suggestedSubject)}
                className="text-xs bg-[#1B3F8B]/10 text-[#1B3F8B] rounded-full px-3 py-1 hover:bg-[#1B3F8B] hover:text-white transition"
              >
                과목: {suggestedSubject}
              </button>
            </div>
          )}

          {/* 입력란 */}
          <div className="space-y-3 bg-white rounded-xl border border-slate-100 p-4">
            <div>
              <label className="text-xs text-slate-500 font-medium block mb-1">과목</label>
              <input
                type="text"
                value={categorySubject}
                onChange={e => setCategorySubject(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#1B3F8B] transition"
                placeholder={suggestedSubject ? `예: ${suggestedSubject}` : '예: 수학, ADsP, 영어'}
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium block mb-1">단원</label>
              <input
                type="text"
                value={categoryTopic}
                onChange={e => setCategoryTopic(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#1B3F8B] transition"
                placeholder="예: 데이터 이해, 일차부등식"
              />
            </div>
            <p className="text-xs text-slate-400">비워두면 분류 없이 저장돼요. 나중에 수정 가능.</p>
          </div>
        </div>

        <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto bg-white border-t border-slate-100 px-4 py-3 z-20 space-y-2">
          <button
            onClick={() => handleSaveToWrongNote(true)}
            disabled={saving || generating}
            className="w-full bg-[#1B3F8B] text-white rounded-xl py-4 text-base font-bold hover:bg-[#163272] transition disabled:opacity-60"
          >
            {(saving || generating) ? '처리 중...' : '🧠 저장하고 유사문제 만들기'}
          </button>
          <button
            onClick={() => handleSaveToWrongNote(false)}
            disabled={saving || generating}
            className="w-full bg-white border border-slate-200 text-slate-600 rounded-xl py-3 text-sm font-medium hover:bg-slate-50 transition disabled:opacity-60"
          >
            💾 저장만 하고 홈으로
          </button>
        </div>
      </div>
    );
  }

  // ─── 미리보기 (생성된 유사문제) ───
  if (view === 'preview') {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col max-w-lg mx-auto">
        <div className="bg-white border-b border-slate-100 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
          <button onClick={() => setView('home')} className="text-slate-400 hover:text-slate-600 transition">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/>
            </svg>
          </button>
          <div className="flex-1">
            <h1 className="font-bold text-slate-800">유사문제 {previewItems.length}개 생성</h1>
            <p className="text-xs text-slate-400">문제은행에 저장됨 · 준비되면 풀어보세요</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 pb-28">
          {previewItems.map((it, idx) => (
            <div key={it.id || idx} className="bg-white rounded-xl border border-slate-100 p-4">
              <div className="flex items-center gap-2 mb-2 text-xs">
                <span className="text-slate-400">#{idx + 1}</span>
                {it.subject && <span className="bg-[#1B3F8B]/10 text-[#1B3F8B] rounded-full px-2 py-0.5 font-medium">{it.subject}</span>}
                {it.topic && <span className="bg-slate-100 text-slate-600 rounded-full px-2 py-0.5">{it.topic}</span>}
                <span className="text-slate-400 ml-auto">
                  {it.question_type === 'multiple_choice' ? '객관식' : it.question_type === 'short_answer' ? '단답형' : '서술형'}
                </span>
              </div>
              <p className="text-sm text-slate-700 leading-relaxed">
                <MathText text={it.question_text} />
              </p>
              <p className="text-xs text-slate-400 mt-2">선택지·정답은 풀이 화면에서 공개돼요</p>
            </div>
          ))}
        </div>

        <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto bg-white border-t border-slate-100 px-4 py-3 z-20 space-y-2">
          <button
            onClick={() => startQuiz(previewItems, 'generated')}
            className="w-full bg-[#1B3F8B] text-white rounded-xl py-4 text-base font-bold hover:bg-[#163272] transition"
          >
            ▶️ 풀어보기
          </button>
          <button
            onClick={() => { setSelectedIds(new Set()); setView('home'); }}
            className="w-full bg-white border border-slate-200 text-slate-600 rounded-xl py-3 text-sm font-medium hover:bg-slate-50 transition"
          >
            나중에 풀게 (오답노트로 돌아가기)
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
