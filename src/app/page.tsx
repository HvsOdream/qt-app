'use client';

import { useState, useEffect } from 'react';

interface Unit {
  id: string;
  code: string;
  title: string;
  level: number;
  children?: Unit[];
}

interface Problem {
  id?: string;
  question_text: string;
  choices: string[];
  correct_answer: string;
  explanation: string;
  bloom_level: number;
  difficulty?: number;
}

export default function Home() {
  const [units, setUnits] = useState<Unit[]>([]);
  const [selectedUnit, setSelectedUnit] = useState<string>('');
  const [selectedUnitName, setSelectedUnitName] = useState<string>('');
  const [difficulty, setDifficulty] = useState<number>(2);
  const [count, setCount] = useState<number>(5);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const [mode, setMode] = useState<'select' | 'quiz' | 'result'>('select');

  // 단원 목록 로드
  useEffect(() => {
    fetch('/api/units')
      .then((res) => res.json())
      .then((data) => setUnits(data.units || []))
      .catch(console.error);
  }, []);

  // 문제 생성
  const generateProblems = async () => {
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
        setMode('quiz');
      }
    } catch (error) {
      console.error('문제 생성 실패:', error);
    } finally {
      setLoading(false);
    }
  };

  // 답 선택
  const handleAnswer = (answerIdx: number) => {
    if (selectedAnswer !== null) return;
    const answer = String(answerIdx + 1);
    setSelectedAnswer(answer);
    setShowExplanation(true);
    const isCorrect = answer === problems[currentIndex].correct_answer;
    setScore((prev) => ({
      correct: prev.correct + (isCorrect ? 1 : 0),
      total: prev.total + 1,
    }));
  };

  // 다음 문제
  const nextProblem = () => {
    if (currentIndex + 1 >= problems.length) {
      setMode('result');
      return;
    }
    setCurrentIndex((prev) => prev + 1);
    setSelectedAnswer(null);
    setShowExplanation(false);
  };

  const bloomLabels: Record<number, string> = {
    1: '기억',
    2: '이해',
    3: '적용',
    4: '분석',
    5: '평가',
  };

  const diffLabels: Record<number, string> = {
    1: '하',
    2: '중',
    3: '상',
  };

  // ─── 단원 선택 화면 ───
  if (mode === 'select') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-indigo-50 to-white">
        <div className="max-w-xl mx-auto px-4 py-12">
          {/* 헤더 */}
          <div className="text-center mb-10">
            <h1 className="text-4xl font-bold text-indigo-900 mb-2">
              QT 큐티
            </h1>
            <p className="text-indigo-600">
              AI 과학 문제 생성기 — 중2 과학
            </p>
          </div>

          {/* 단원 선택 */}
          <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">
              단원 선택
            </h2>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {units.map((l1) => (
                <details key={l1.id} className="group">
                  <summary className="cursor-pointer py-2 px-3 rounded-lg hover:bg-indigo-50 font-medium text-gray-700">
                    {l1.code}. {l1.title}
                  </summary>
                  <div className="ml-4 mt-1 space-y-1">
                    {l1.children?.map((l2) => (
                      <details key={l2.id} className="group/sub">
                        <summary className="cursor-pointer py-1.5 px-3 rounded hover:bg-indigo-50 text-sm text-gray-600">
                          {l2.code}. {l2.title}
                        </summary>
                        <div className="ml-4 mt-1 space-y-0.5">
                          {l2.children?.map((l3) => (
                            <button
                              key={l3.id}
                              onClick={() => {
                                setSelectedUnit(l3.id);
                                setSelectedUnitName(
                                  `${l3.code} ${l3.title}`
                                );
                              }}
                              className={`w-full text-left py-1.5 px-3 rounded text-sm transition-colors ${
                                selectedUnit === l3.id
                                  ? 'bg-indigo-100 text-indigo-800 font-medium'
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
              <div className="mt-3 text-sm text-indigo-600 bg-indigo-50 px-3 py-2 rounded-lg">
                선택: {selectedUnitName}
              </div>
            )}
          </div>

          {/* 난이도 & 문제 수 */}
          <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
            <div className="flex gap-6">
              <div className="flex-1">
                <label className="text-sm font-medium text-gray-700 mb-2 block">
                  난이도
                </label>
                <div className="flex gap-2">
                  {[1, 2, 3].map((d) => (
                    <button
                      key={d}
                      onClick={() => setDifficulty(d)}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                        difficulty === d
                          ? 'bg-indigo-600 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {diffLabels[d]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1">
                <label className="text-sm font-medium text-gray-700 mb-2 block">
                  문제 수
                </label>
                <select
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                  className="w-full py-2 px-3 rounded-lg border border-gray-200 text-sm"
                >
                  {[3, 5, 10].map((n) => (
                    <option key={n} value={n}>
                      {n}문제
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* 시작 버튼 */}
          <button
            onClick={generateProblems}
            disabled={!selectedUnit || loading}
            className="w-full py-4 rounded-2xl bg-indigo-600 text-white font-semibold text-lg shadow-lg hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? '문제 생성 중...' : '문제 풀기 시작'}
          </button>
        </div>
      </div>
    );
  }

  // ─── 퀴즈 화면 ───
  if (mode === 'quiz' && problems.length > 0) {
    const problem = problems[currentIndex];
    return (
      <div className="min-h-screen bg-gradient-to-b from-indigo-50 to-white">
        <div className="max-w-xl mx-auto px-4 py-8">
          {/* 진행바 */}
          <div className="flex items-center justify-between mb-6">
            <span className="text-sm text-gray-500">
              {currentIndex + 1} / {problems.length}
            </span>
            <div className="flex-1 mx-4 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-600 rounded-full transition-all"
                style={{
                  width: `${((currentIndex + 1) / problems.length) * 100}%`,
                }}
              />
            </div>
            <span className="text-sm font-medium text-indigo-600">
              {score.correct}/{score.total}
            </span>
          </div>

          {/* 문제 카드 */}
          <div className="bg-white rounded-2xl shadow-lg p-6 mb-4">
            <div className="flex items-center gap-2 mb-4">
              <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs rounded-full font-medium">
                {bloomLabels[problem.bloom_level] || '기타'}
              </span>
              {problem.difficulty && (
                <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
                  난이도 {diffLabels[problem.difficulty]}
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
              let btnClass =
                'w-full text-left p-4 rounded-xl border-2 transition-all text-sm';

              if (selectedAnswer === null) {
                btnClass +=
                  ' border-gray-200 hover:border-indigo-300 hover:bg-indigo-50';
              } else if (isCorrect) {
                btnClass += ' border-green-500 bg-green-50 text-green-800';
              } else if (isSelected && !isCorrect) {
                btnClass += ' border-red-400 bg-red-50 text-red-800';
              } else {
                btnClass += ' border-gray-100 text-gray-400';
              }

              return (
                <button
                  key={idx}
                  onClick={() => handleAnswer(idx)}
                  className={btnClass}
                >
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
              className="w-full py-3 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition-colors"
            >
              {currentIndex + 1 >= problems.length
                ? '결과 보기'
                : '다음 문제'}
            </button>
          )}
        </div>
      </div>
    );
  }

  // ─── 결과 화면 ───
  if (mode === 'result') {
    const percentage = Math.round((score.correct / score.total) * 100);
    return (
      <div className="min-h-screen bg-gradient-to-b from-indigo-50 to-white flex items-center justify-center">
        <div className="max-w-md mx-auto px-4 text-center">
          <div className="bg-white rounded-3xl shadow-xl p-10">
            <div className="text-6xl mb-4">
              {percentage >= 80 ? '🎉' : percentage >= 60 ? '👍' : '💪'}
            </div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">
              퀴즈 완료!
            </h2>
            <p className="text-5xl font-bold text-indigo-600 my-6">
              {score.correct}/{score.total}
            </p>
            <p className="text-gray-500 mb-8">정답률 {percentage}%</p>
            <div className="space-y-3">
              <button
                onClick={() => {
                  setMode('quiz');
                  setCurrentIndex(0);
                  setSelectedAnswer(null);
                  setShowExplanation(false);
                  setScore({ correct: 0, total: 0 });
                }}
                className="w-full py-3 rounded-xl bg-indigo-100 text-indigo-700 font-medium hover:bg-indigo-200 transition-colors"
              >
                같은 문제 다시 풀기
              </button>
              <button
                onClick={() => {
                  setMode('select');
                  setProblems([]);
                }}
                className="w-full py-3 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition-colors"
              >
                다른 단원 선택
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
