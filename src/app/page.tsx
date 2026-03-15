'use client';

import { useState, useEffect, useRef } from 'react';

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

// ─── 메인 컴포넌트 ───
export default function Home() {
  // 공통 상태
  const [mode, setMode] = useState<'home' | 'parsed' | 'quiz' | 'result'>('home');
  const [tab, setTab] = useState<'photo' | 'unit'>('photo');

  // 사진 업로드 상태
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [selectedParsedIdx, setSelectedParsedIdx] = useState<number[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 단원 선택 상태 (기존)
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

  // 단원 목록 로드
  useEffect(() => {
    fetch('/api/units')
      .then((res) => res.json())
      .then((data) => setUnits(data.units || []))
      .catch(console.error);
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
      // 기본으로 모든 문제 선택
      setSelectedParsedIdx(data.problems.map((_: ParsedProblem, i: number) => i));
      setMode('parsed');
    } catch (error) {
      console.error('파싱 실패:', error);
      alert('이미지 분석에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setParsing(false);
    }
  };

  // ─── 유사 문제 생성 (사진 기반) ───
  const generateSimilar = async () => {
    if (!parseResult || selectedParsedIdx.length === 0) return;
    setLoading(true);
    try {
      const allProblems: QuizProblem[] = [];
      // 선택된 각 문제에 대해 유사 문제 생성
      for (const idx of selectedParsedIdx) {
        const original = parseResult.problems[idx];
        const res = await fetch('/api/generate-similar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            originalProblem: original,
            count: Math.max(1, Math.floor(count / selectedParsedIdx.length)),
            difficulty,
          }),
        });
        const data = await res.json();
        if (data.problems) {
          allProblems.push(...data.problems);
        }
      }
      if (allProblems.length > 0) {
        setProblems(allProblems.slice(0, count));
        setCurrentIndex(0);
        setSelectedAnswer(null);
        setShowExplanation(false);
        setScore({ correct: 0, total: 0 });
        setQuizAnswers([]);
        setMode('quiz');
      }
    } catch (error) {
      console.error('유사 문제 생성 실패:', error);
      alert('문제 생성에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // ─── 단원 기반 문제 생성 (기존) ───
  const generateFromUnit = async () => {
    if (!selectedUnit) return;
    setLoading(true);
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unitId: selectedUnit, difficulty, count }),
      });
      const data = await res.json();
      if (data.problems) {
        setProblems(data.problems);
        setCurrentIndex(0);
        setSelectedAnswer(null);
        setShowExplanation(false);
        setScore({ correct: 0, total: 0 });
        setQuizAnswers([]);
        setMode('quiz');
      }
    } catch (error) {
      console.error('문제 생성 실패:', error);
    } finally {
      setLoading(false);
    }
  };

  // ─── 답 선택 ───
  const handleAnswer = async (answerIdx: number) => {
    if (selectedAnswer !== null) return;
    const answer = String(answerIdx + 1);
    setSelectedAnswer(answer);
    setShowExplanation(true);
    const isCorrect = answer === problems[currentIndex].correct_answer;
    setScore((prev) => ({
      correct: prev.correct + (isCorrect ? 1 : 0),
      total: prev.total + 1,
    }));

    const problem = problems[currentIndex];
    setQuizAnswers((prev) => [...prev, {
      question: problem.question_text,
      studentAnswer: answer,
      correctAnswer: problem.correct_answer,
      isCorrect,
      subject: problem.subject,
      topic: problem.topic,
      keywords: problem.keywords,
    }]);

    // 오답이면 quiz_results에 기록
    try {
      await fetch('/api/save-result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question_text: problem.question_text,
          choices: problem.choices,
          correct_answer: problem.correct_answer,
          student_answer: answer,
          is_correct: isCorrect,
          subject: problem.subject || null,
          topic: problem.topic || null,
          keywords: problem.keywords || [],
        }),
      });
    } catch {
      // 기록 실패해도 무시
    }
  };

  // ─── 다음 문제 ───
  const nextProblem = () => {
    if (currentIndex + 1 >= problems.length) {
      setMode('result');
      return;
    }
    setCurrentIndex((prev) => prev + 1);
    setSelectedAnswer(null);
    setShowExplanation(false);
  };

  // ─── 초기화 ───
  const resetAll = () => {
    setMode('home');
    setProblems([]);
    setParseResult(null);
    setImageFile(null);
    setImagePreview(null);
    setSelectedParsedIdx([]);
    setSelectedUnit('');
    setSelectedUnitName('');
    setQuizAnswers([]);
  };

  const bloomLabels: Record<number, string> = { 1: '기억', 2: '이해', 3: '적용', 4: '분석', 5: '평가' };
  const diffLabels: Record<number, string> = { 1: '하', 2: '중', 3: '상' };

  // ═══════════════════════════════════════
  // 홈 화면
  // ═══════════════════════════════════════
  if (mode === 'home') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-violet-50 to-white">
        <div className="max-w-xl mx-auto px-4 py-10">
          {/* 헤더 */}
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-violet-900 mb-1">QT 큐티</h1>
            <p className="text-violet-500 text-sm">틀린 문제 찍으면, AI가 다시 내준다</p>
          </div>

          {/* 탭 전환 */}
          <div className="flex bg-violet-100 rounded-xl p-1 mb-6">
            <button
              onClick={() => setTab('photo')}
              className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                tab === 'photo' ? 'bg-white text-violet-700 shadow-sm' : 'text-violet-500'
              }`}
            >
              📷 사진으로 풀기
            </button>
            <button
              onClick={() => setTab('unit')}
              className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                tab === 'unit' ? 'bg-white text-violet-700 shadow-sm' : 'text-violet-500'
              }`}
            >
              📚 단원 선택
            </button>
          </div>

          {/* ── 사진 업로드 탭 ── */}
          {tab === 'photo' && (
            <>
              <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
                <h2 className="text-base font-semibold text-gray-800 mb-3">틀린 문제 사진 업로드</h2>
                <p className="text-xs text-gray-400 mb-4">시험지, 모의고사, 워크북 등 어떤 과목이든 OK</p>

                {/* 이미지 업로드 영역 */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleImageSelect}
                  className="hidden"
                />

                {imagePreview ? (
                  <div className="relative mb-4">
                    <img
                      src={imagePreview}
                      alt="업로드된 문제"
                      className="w-full rounded-xl border border-gray-200 max-h-80 object-contain bg-gray-50"
                    />
                    <button
                      onClick={() => {
                        setImageFile(null);
                        setImagePreview(null);
                        setParseResult(null);
                      }}
                      className="absolute top-2 right-2 w-8 h-8 bg-black/50 text-white rounded-full flex items-center justify-center text-sm"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full h-48 border-2 border-dashed border-violet-300 rounded-xl flex flex-col items-center justify-center gap-2 text-violet-400 hover:border-violet-500 hover:text-violet-600 transition-colors mb-4"
                  >
                    <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span className="text-sm font-medium">사진 찍기 / 이미지 선택</span>
                  </button>
                )}

                {imageFile && !parsing && (
                  <button
                    onClick={handleParseImage}
                    className="w-full py-3 rounded-xl bg-violet-600 text-white font-medium hover:bg-violet-700 transition-colors"
                  >
                    문제 분석하기
                  </button>
                )}

                {parsing && (
                  <div className="w-full py-3 rounded-xl bg-violet-200 text-violet-700 font-medium text-center">
                    <span className="inline-block animate-spin mr-2">⏳</span>
                    AI가 문제를 분석하고 있어요...
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── 단원 선택 탭 ── */}
          {tab === 'unit' && (
            <>
              <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
                <h2 className="text-base font-semibold text-gray-800 mb-3">단원 선택</h2>
                <p className="text-xs text-gray-400 mb-4">중2 과학 · 천재교과서</p>
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {units.map((l1) => (
                    <details key={l1.id} className="group">
                      <summary className="cursor-pointer py-2 px-3 rounded-lg hover:bg-violet-50 font-medium text-gray-700 text-sm">
                        {l1.code}. {l1.title}
                      </summary>
                      <div className="ml-4 mt-1 space-y-1">
                        {l1.children?.map((l2) => (
                          <details key={l2.id} className="group/sub">
                            <summary className="cursor-pointer py-1.5 px-3 rounded hover:bg-violet-50 text-xs text-gray-600">
                              {l2.code}. {l2.title}
                            </summary>
                            <div className="ml-4 mt-1 space-y-0.5">
                              {l2.children?.map((l3) => (
                                <button
                                  key={l3.id}
                                  onClick={() => { setSelectedUnit(l3.id); setSelectedUnitName(`${l3.code} ${l3.title}`); }}
                                  className={`w-full text-left py-1.5 px-3 rounded text-xs transition-colors ${
                                    selectedUnit === l3.id
                                      ? 'bg-violet-100 text-violet-800 font-medium'
                                      : 'text-gray-500 hover:bg-gray-50'
                                  }`}
                                >
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
                {selectedUnit && (
                  <div className="mt-3 text-xs text-violet-600 bg-violet-50 px-3 py-2 rounded-lg">
                    선택: {selectedUnitName}
                  </div>
                )}
              </div>

              {/* 난이도 & 문제 수 */}
              <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
                <div className="flex gap-6">
                  <div className="flex-1">
                    <label className="text-xs font-medium text-gray-700 mb-2 block">난이도</label>
                    <div className="flex gap-2">
                      {[1, 2, 3].map((d) => (
                        <button
                          key={d}
                          onClick={() => setDifficulty(d)}
                          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                            difficulty === d ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                        >
                          {diffLabels[d]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex-1">
                    <label className="text-xs font-medium text-gray-700 mb-2 block">문제 수</label>
                    <select
                      value={count}
                      onChange={(e) => setCount(Number(e.target.value))}
                      className="w-full py-2 px-3 rounded-lg border border-gray-200 text-sm"
                    >
                      {[3, 5, 10].map((n) => (
                        <option key={n} value={n}>{n}문제</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <button
                onClick={generateFromUnit}
                disabled={!selectedUnit || loading}
                className="w-full py-4 rounded-2xl bg-violet-600 text-white font-semibold text-lg shadow-lg hover:bg-violet-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? '문제 생성 중...' : '문제 풀기 시작'}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════
  // 파싱 결과 화면 (사진에서 인식된 문제 확인)
  // ═══════════════════════════════════════
  if (mode === 'parsed' && parseResult) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-violet-50 to-white">
        <div className="max-w-xl mx-auto px-4 py-8">
          {/* 뒤로가기 */}
          <button onClick={resetAll} className="text-violet-600 text-sm mb-4 flex items-center gap-1">
            ← 다시 촬영
          </button>

          <h2 className="text-xl font-bold text-gray-800 mb-1">분석 완료!</h2>
          <p className="text-sm text-gray-500 mb-6">
            {parseResult.overall_subject} · {parseResult.source_description} · {parseResult.problems.length}문제 발견
          </p>

          {/* 파싱된 문제 목록 */}
          <div className="space-y-3 mb-6">
            {parseResult.problems.map((p, idx) => (
              <div
                key={idx}
                onClick={() => {
                  setSelectedParsedIdx((prev) =>
                    prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
                  );
                }}
                className={`bg-white rounded-xl p-4 shadow-sm border-2 cursor-pointer transition-colors ${
                  selectedParsedIdx.includes(idx) ? 'border-violet-500' : 'border-transparent'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5 ${
                    selectedParsedIdx.includes(idx) ? 'bg-violet-600 text-white' : 'bg-gray-200 text-gray-500'
                  }`}>
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 leading-relaxed line-clamp-3">{p.question_text}</p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      <span className="px-2 py-0.5 bg-violet-100 text-violet-700 text-xs rounded-full">{p.subject}</span>
                      <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">{p.topic}</span>
                      {p.keywords.slice(0, 2).map((kw, ki) => (
                        <span key={ki} className="px-2 py-0.5 bg-amber-50 text-amber-700 text-xs rounded-full">{kw}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* 옵션 */}
          <div className="bg-white rounded-2xl shadow-lg p-5 mb-6">
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="text-xs font-medium text-gray-700 mb-2 block">유사 문제 수</label>
                <select
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                  className="w-full py-2 px-3 rounded-lg border border-gray-200 text-sm"
                >
                  {[3, 5, 10].map((n) => (
                    <option key={n} value={n}>{n}문제</option>
                  ))}
                </select>
              </div>
              <div className="flex-1">
                <label className="text-xs font-medium text-gray-700 mb-2 block">난이도 조절</label>
                <div className="flex gap-1.5">
                  {[1, 2, 3].map((d) => (
                    <button
                      key={d}
                      onClick={() => setDifficulty(d)}
                      className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${
                        difficulty === d ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {d === 1 ? '쉽게' : d === 2 ? '비슷' : '어렵게'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={generateSimilar}
            disabled={selectedParsedIdx.length === 0 || loading}
            className="w-full py-4 rounded-2xl bg-violet-600 text-white font-semibold text-lg shadow-lg hover:bg-violet-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? (
              <span><span className="inline-block animate-spin mr-2">⏳</span>유사 문제 생성 중...</span>
            ) : (
              `선택한 ${selectedParsedIdx.length}문제로 연습 시작`
            )}
          </button>
        </div>
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
        <div className="max-w-xl mx-auto px-4 py-8">
          {/* 진행바 */}
          <div className="flex items-center justify-between mb-6">
            <span className="text-sm text-gray-500">{currentIndex + 1} / {problems.length}</span>
            <div className="flex-1 mx-4 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-violet-600 rounded-full transition-all"
                style={{ width: `${((currentIndex + 1) / problems.length) * 100}%` }}
              />
            </div>
            <span className="text-sm font-medium text-violet-600">{score.correct}/{score.total}</span>
          </div>

          {/* 문제 카드 */}
          <div className="bg-white rounded-2xl shadow-lg p-6 mb-4">
            <div className="flex items-center gap-2 mb-4">
              <span className="px-2 py-0.5 bg-violet-100 text-violet-700 text-xs rounded-full font-medium">
                {bloomLabels[problem.bloom_level] || '기타'}
              </span>
              {problem.subject && (
                <span className="px-2 py-0.5 bg-blue-50 text-blue-600 text-xs rounded-full">
                  {problem.subject}
                </span>
              )}
              {problem.topic && (
                <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
                  {problem.topic}
                </span>
              )}
            </div>
            <p className="text-lg font-medium text-gray-800 leading-relaxed whitespace-pre-wrap">
              {problem.question_text}
            </p>
          </div>

          {/* 선택지 */}
          <div className="space-y-3 mb-6">
            {problem.choices.map((choice, idx) => {
              const answerNum = String(idx + 1);
              const isSelected = selectedAnswer === answerNum;
              const isCorrect = answerNum === problem.correct_answer;
              let btnClass = 'w-full text-left p-4 rounded-xl border-2 transition-all text-sm';

              if (selectedAnswer === null) {
                btnClass += ' border-gray-200 hover:border-violet-300 hover:bg-violet-50';
              } else if (isCorrect) {
                btnClass += ' border-green-500 bg-green-50 text-green-800';
              } else if (isSelected && !isCorrect) {
                btnClass += ' border-red-400 bg-red-50 text-red-800';
              } else {
                btnClass += ' border-gray-100 text-gray-400';
              }

              return (
                <button key={idx} onClick={() => handleAnswer(idx)} className={btnClass}>
                  {choice}
                </button>
              );
            })}
          </div>

          {/* 해설 */}
          {showExplanation && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-6">
              <h3 className="font-semibold text-amber-800 mb-2">해설</h3>
              <p className="text-sm text-amber-900 leading-relaxed whitespace-pre-wrap">
                {problem.explanation}
              </p>
            </div>
          )}

          {/* 다음 버튼 */}
          {showExplanation && (
            <button
              onClick={nextProblem}
              className="w-full py-3 rounded-xl bg-violet-600 text-white font-medium hover:bg-violet-700 transition-colors"
            >
              {currentIndex + 1 >= problems.length ? '결과 보기' : '다음 문제'}
            </button>
          )}
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════
  // 결과 화면
  // ═══════════════════════════════════════
  if (mode === 'result') {
    const percentage = score.total > 0 ? Math.round((score.correct / score.total) * 100) : 0;
    const wrongOnes = quizAnswers.filter((a) => !a.isCorrect);

    return (
      <div className="min-h-screen bg-gradient-to-b from-violet-50 to-white">
        <div className="max-w-xl mx-auto px-4 py-10">
          <div className="bg-white rounded-3xl shadow-xl p-8 text-center mb-6">
            <div className="text-5xl mb-3">
              {percentage >= 80 ? '🎉' : percentage >= 60 ? '👍' : '💪'}
            </div>
            <h2 className="text-2xl font-bold text-gray-800 mb-1">퀴즈 완료!</h2>
            <p className="text-4xl font-bold text-violet-600 my-4">{score.correct}/{score.total}</p>
            <p className="text-gray-500 mb-2">정답률 {percentage}%</p>
            {wrongOnes.length > 0 && (
              <p className="text-sm text-red-500">틀린 문제 {wrongOnes.length}개 — 오답 데이터에 저장됨</p>
            )}
          </div>

          {/* 틀린 문제 요약 */}
          {wrongOnes.length > 0 && (
            <div className="bg-white rounded-2xl shadow-lg p-5 mb-6">
              <h3 className="font-semibold text-gray-800 mb-3 text-sm">틀린 문제 요약</h3>
              <div className="space-y-3">
                {wrongOnes.map((w, i) => (
                  <div key={i} className="bg-red-50 rounded-lg p-3">
                    <p className="text-xs text-gray-700 line-clamp-2 mb-1">{w.question}</p>
                    <div className="flex gap-2 text-xs">
                      <span className="text-red-600">내 답: {w.studentAnswer}번</span>
                      <span className="text-green-600">정답: {w.correctAnswer}번</span>
                    </div>
                    {w.topic && (
                      <span className="inline-block mt-1 px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
                        {w.topic}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-3">
            <button
              onClick={() => {
                setMode('quiz');
                setCurrentIndex(0);
                setSelectedAnswer(null);
                setShowExplanation(false);
                setScore({ correct: 0, total: 0 });
                setQuizAnswers([]);
              }}
              className="w-full py-3 rounded-xl bg-violet-100 text-violet-700 font-medium hover:bg-violet-200 transition-colors"
            >
              같은 문제 다시 풀기
            </button>
            <button
              onClick={resetAll}
              className="w-full py-3 rounded-xl bg-violet-600 text-white font-medium hover:bg-violet-700 transition-colors"
            >
              새 문제 시작
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
