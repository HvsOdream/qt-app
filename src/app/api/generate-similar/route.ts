import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getServiceClient } from '@/lib/supabase';

const SYSTEM_PROMPT = `너는 시험 문제 출제 전문가야. 학생이 틀린 문제를 기반으로 같은 개념의 유사 문제를 생성한다.

## 출제 원칙
- 원본 문제와 같은 개념/유형이지만 다른 수치/상황으로 변형
- 하나의 명확한 정답만 존재
- 매력적 오답은 학생의 흔한 오개념에서 설계
- 해설은 "왜 정답인지" + "왜 오답인지" + "원본 문제와의 관계" 포함
- 학생이 같은 실수를 반복하지 않도록 핵심 포인트 강조

## 출력 형식
반드시 JSON 배열로 출력. 마크다운 코드블록 없이 순수 JSON만.

[
  {
    "question_text": "문제 본문",
    "choices": ["①선택지1", "②선택지2", "③선택지3", "④선택지4"],
    "correct_answer": "1",
    "explanation": "정답 해설 (원본 문제 연관 설명 포함)",
    "bloom_level": 2,
    "subject": "과목",
    "topic": "단원/주제",
    "keywords": ["핵심개념1", "핵심개념2"],
    "question_type": "multiple_choice"
  }
]

## ★ correct_answer 규칙 (매우 중요)
- correct_answer는 반드시 **순수 숫자 문자열**로 출력: "1", "2", "3", "4"
- 절대로 "①", "③번", "3번" 같은 형식 사용 금지
- 선택지 순서대로 1번부터 번호 매김 (첫 번째 선택지 = "1")

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
    const { originalProblem, count = 3, difficulty } = await request.json();

    if (!originalProblem || !originalProblem.question_text) {
      return NextResponse.json(
        { error: '원본 문제 정보가 필요합니다.' },
        { status: 400 }
      );
    }

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const diffLabel: Record<number, string> = { 1: '쉽게', 2: '비슷하게', 3: '어렵게' };
    const diffInstruction = difficulty
      ? `난이도는 원본보다 ${diffLabel[difficulty] || '비슷하게'} 출제해.`
      : '난이도는 원본과 비슷하게 유지해.';

    const userPrompt = `학생이 다음 문제를 틀렸어. 이 문제와 같은 개념의 유사 문제를 ${count}개 생성해줘.

## 원본 문제
- 과목: ${originalProblem.subject || '알 수 없음'}
- 주제: ${originalProblem.topic || '알 수 없음'}
- 핵심 키워드: ${(originalProblem.keywords || []).join(', ')}
- 문제: ${originalProblem.question_text}
${originalProblem.choices?.length ? `- 선택지: ${originalProblem.choices.join(' / ')}` : ''}
${originalProblem.correct_answer ? `- 정답: ${originalProblem.correct_answer}번` : ''}
${originalProblem.marked_answer ? `- 학생 답: ${originalProblem.marked_answer}번 (오답)` : ''}

## 요구사항
- ${diffInstruction}
- 같은 개념이지만 숫자/상황/맥락을 바꿔서 출제
- 학생이 틀린 포인트를 집중 연습할 수 있도록 설계
- 해설에서 원본 문제와의 연관성을 언급해줘

JSON 배열로만 출력해.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
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
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const generated = JSON.parse(jsonText);

    // Supabase에 오답 기록 저장 (선택적)
    try {
      const supabase = getServiceClient();
      await supabase.from('wrong_answers').insert({
        original_question: originalProblem.question_text,
        subject: originalProblem.subject || null,
        topic: originalProblem.topic || null,
        keywords: originalProblem.keywords || [],
        marked_answer: originalProblem.marked_answer || null,
        correct_answer: originalProblem.correct_answer || null,
        similar_count: count,
      });
    } catch (dbError) {
      // DB 저장 실패해도 문제 생성 응답은 반환
      console.error('오답 기록 저장 실패:', dbError);
    }

    return NextResponse.json({
      problems: generated,
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
