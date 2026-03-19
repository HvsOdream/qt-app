import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getServiceClient } from '@/lib/supabase';

export const maxDuration = 60;

const SYSTEM_PROMPT = `너는 시험 문제 출제 전문가야. 학생이 틀린 문제를 기반으로 같은 개념의 유사 문제를 생성한다.

## 출제 원칙
- 원본 문제와 같은 개념/유형이지만 다른 수치/상황으로 변형
- 하나의 명확한 정답만 존재
- 매력적 오답은 학생의 흔한 오개념에서 설계
- 해설은 "왜 정답인지" + "왜 오답인지" + "원본 문제와의 관계" 포함
- 학생이 같은 실수를 반복하지 않도록 핵심 포인트 강조

## 출력 형식
반드시 JSON 배열로 출력. 마크다운 코드블록 없이 순수 JSON만.

### 객관식 (multiple_choice) 예시:
{
  "question_text": "문제 본문",
  "choices": ["①선택지1", "②선택지2", "③선택지3", "④선택지4"],
  "correct_answer": "1",
  "explanation": "정답 해설",
  "bloom_level": 2,
  "subject": "과목",
  "topic": "단원/주제",
  "keywords": ["핵심개념1"],
  "question_type": "multiple_choice"
}

### 주관식 단답형 (short_answer) 예시:
{
  "question_text": "다음 일차부등식의 해를 구하시오. ...",
  "choices": [],
  "correct_answer": "-6",
  "explanation": "풀이 과정 해설",
  "bloom_level": 3,
  "subject": "수학",
  "topic": "일차부등식",
  "keywords": ["부등식"],
  "question_type": "short_answer"
}

### 서술형 (essay) 예시:
{
  "question_text": "풀이 과정을 서술하시오. ...",
  "choices": [],
  "correct_answer": "모범답안 전체 (풀이 과정 포함)",
  "explanation": "채점 기준: 완전정답/부분정답/오답 기준 포함",
  "bloom_level": 4,
  "subject": "수학",
  "topic": "일차부등식",
  "keywords": ["부등식"],
  "question_type": "essay"
}

## ★ question_type 변환 규칙 (매우 중요)
- 원본이 **multiple_choice** → 유사 문제도 multiple_choice
- 원본이 **short_answer 또는 essay**이고 **수학/과학** 과목 → **multiple_choice로 변환** (모바일에서 수식 입력이 어려우므로, 정답을 선택지 중 하나로 넣고 매력적 오답 3개를 추가)
- 원본이 **short_answer**이고 **국어/영어/사회** 과목 → short_answer 유지 (텍스트 입력 가능)
- 원본이 **essay** → multiple_choice로 변환 (핵심 개념을 묻는 객관식으로)

## ★ correct_answer 규칙
- **multiple_choice**: 반드시 순수 숫자 문자열 "1","2","3","4". "①","3번" 금지
- **short_answer**: 정답 값 (예: "-6", "a = 3", "6 ≤ a ＜ 8")
- **essay**: 모범답안 전체 텍스트

## 수식 표기 규칙
- 부등호: 반드시 ＜ ＞ ≤ ≥ (전각/유니코드) 사용. HTML 태그로 해석될 수 있는 < > 사용 금지
- 분수: a/b 형태
- 거듭제곱: a^n 형태
- 루트: √ 기호 사용

## bloom_level 기준
1 = 기억 (용어, 정의 재인)
2 = 이해 (개념 설명, 비교)
3 = 적용 (계산, 실험 해석)
4 = 분석 (자료 비교, 변인 파악)
5 = 평가 (옳고 그름 판단)`;

export async function POST(request: NextRequest) {
  try {
    const deviceId = request.headers.get('x-device-id') || 'unknown';
    const { originalProblem, count = 3, difficulty } = await request.json();

    if (!originalProblem || !originalProblem.question_text) {
      return NextResponse.json(
        { error: '원본 문제 정보가 필요합니다.' },
        { status: 400 }
      );
    }

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const supabase = getServiceClient();

    const diffLabel: Record<number, string> = { 1: '쉽게', 2: '비슷하게', 3: '어렵게' };
    const diffInstruction = difficulty
      ? `난이도는 원본보다 ${diffLabel[difficulty] || '비슷하게'} 출제해.`
      : '난이도는 원본과 비슷하게 유지해.';

    const questionType = originalProblem.question_type || (originalProblem.choices?.length > 0 ? 'multiple_choice' : 'short_answer');
    const typeLabel: Record<string, string> = { multiple_choice: '객관식', short_answer: '주관식 단답형', essay: '서술형' };
    const choiceCount = originalProblem.choices?.length || 0;

    const userPrompt = `학생이 다음 문제를 틀렸어. 이 문제와 같은 개념의 유사 문제를 ${count}개 생성해줘.

## 원본 문제
- 과목: ${originalProblem.subject || '알 수 없음'}
- 주제: ${originalProblem.topic || '알 수 없음'}
- 문제 유형: **${typeLabel[questionType] || questionType}** (question_type: "${questionType}")
- 핵심 키워드: ${(originalProblem.keywords || []).join(', ')}
- 문제: ${originalProblem.question_text}
${originalProblem.choices?.length ? `- 선택지: ${originalProblem.choices.join(' / ')}` : '- (선택지 없음 — 주관식/서술형)'}
${originalProblem.correct_answer ? `- 정답: ${originalProblem.correct_answer}` : ''}
${originalProblem.marked_answer ? `- 학생 답: ${originalProblem.marked_answer} (오답)` : ''}

## 요구사항
- ${diffInstruction}
- 원본 문제 유형: ${typeLabel[questionType] || questionType}. 위 question_type 변환 규칙에 따라 적절한 유형으로 출제할 것
- ${choiceCount > 0 ? `객관식인 경우 선택지 수는 원본과 동일하게 ${choiceCount}지선다로` : '수학/과학이면 객관식으로 변환, 그 외 과목은 주관식 유지'}
- 같은 개념이지만 숫자/상황/맥락을 바꿔서 출제
- 학생이 틀린 포인트를 집중 연습할 수 있도록 설계
- 해설에서 원본 문제와의 연관성을 언급해줘

JSON 배열로만 출력해.`;

    // 토큰 절약: 문제 수에 비례한 max_tokens 할당 (문제당 ~600토큰)
    const estimatedTokens = Math.min(4096, Math.max(1500, count * 600));

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: estimatedTokens,
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: userPrompt },
      ],
    });

    const textContent = message.content[0];
    if (textContent.type !== 'text') {
      return NextResponse.json(
        { error: 'API 응답 형식 오류' },
        { status: 500 }
      );
    }

    let jsonText = textContent.text.trim();

    // 1) 마크다운 코드블록 제거
    jsonText = jsonText.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();

    // 2) JSON 배열을 정규식으로 추출 (앞뒤 설명 텍스트 무시)
    const arrayMatch = jsonText.match(/\[[\s\S]*\]/);
    if (arrayMatch) jsonText = arrayMatch[0];

    // 3) 파싱 시도
    let generated: Record<string, unknown>[];
    try {
      generated = JSON.parse(jsonText);
    } catch {
      // 4) 실패 시 단일 객체일 수도 있으므로 배열로 감싸서 재시도
      const objMatch = textContent.text.match(/\{[\s\S]*\}/);
      if (objMatch) {
        generated = [JSON.parse(objMatch[0])];
      } else {
        throw new Error('JSON 파싱 실패: ' + textContent.text.slice(0, 100));
      }
    }

    // ─── DB 저장: wrong_answers (원본 오답) ───
    let wrongAnswerId: string | null = null;
    try {
      const { data: waData } = await supabase.from('wrong_answers').insert({
        original_question: originalProblem.question_text,
        subject: originalProblem.subject || null,
        topic: originalProblem.topic || null,
        keywords: originalProblem.keywords || [],
        marked_answer: originalProblem.marked_answer || null,
        correct_answer: originalProblem.correct_answer || null,
        similar_count: count,
      }).select('id').single();
      wrongAnswerId = waData?.id || null;
    } catch (dbError) {
      console.error('오답 기록 저장 실패:', dbError);
    }

    // ─── DB 저장: question_bank (생성된 문제) ───
    const batchId = crypto.randomUUID();
    let savedProblems = generated;

    try {
      const rows = generated.map((q: Record<string, unknown>) => ({
        question_text: q.question_text,
        choices: q.choices || [],
        correct_answer: q.correct_answer,
        explanation: q.explanation || null,
        subject: q.subject || originalProblem.subject || null,
        topic: q.topic || originalProblem.topic || null,
        keywords: q.keywords || originalProblem.keywords || [],
        difficulty: q.difficulty || difficulty || 2,
        bloom_level: q.bloom_level || 2,
        question_type: q.question_type || 'multiple_choice',
        source: 'ai_generated',
        parent_wrong_answer_id: wrongAnswerId,
        generation_batch_id: batchId,
        device_id: deviceId,
      }));

      const { data: bankData, error: bankError } = await supabase
        .from('question_bank')
        .insert(rows)
        .select();

      if (bankError) {
        console.error('question_bank 저장 실패:', bankError);
        // DB 저장 실패해도 생성된 문제는 반환 (id 없이)
      } else if (bankData) {
        // DB에서 받은 id를 포함한 데이터로 교체
        savedProblems = bankData;
      }
    } catch (bankDbError) {
      console.error('question_bank 저장 예외:', bankDbError);
    }

    return NextResponse.json({
      problems: savedProblems,
      batch_id: batchId,
      original: originalProblem,
      source: 'ai_generated',
    });
  } catch (error) {
    console.error('유사 문제 생성 오류:', error);
    return NextResponse.json(
      { error: '유사 문제 생성 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
