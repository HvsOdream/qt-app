import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

// 오답 기반 동적 주제로 문제 생성 (units 테이블 불필요)
function buildSystemPrompt(subject: string, topic: string, keywords: string[]): string {
  const kwText = keywords.length > 0 ? `\n핵심 키워드: ${keywords.join(', ')}` : '';
  return `너는 ${subject} 분야 시험/자격증 문제 출제 전문가야.
주제: ${topic}${kwText}

## 출제 원칙
- 해당 분야의 정확한 지식 기반
- 하나의 명확한 정답만 존재
- 매력적 오답은 학습자의 흔한 오개념에서 설계
- 해설은 "왜 정답인지" + "왜 오답인지" 모두 포함
- 실제 시험 스타일에 맞춰 출제

## 출력 형식
반드시 JSON 배열로 출력. 마크다운 코드블록 없이 순수 JSON만.

[
  {
    "question_text": "문제 본문",
    "choices": ["①선택지1", "②선택지2", "③선택지3", "④선택지4", "⑤선택지5"],
    "correct_answer": "3",
    "explanation": "정답 해설 (오답 이유 포함)",
    "bloom_level": 2,
    "question_type": "multiple_choice",
    "subject": "${subject}",
    "topic": "${topic}",
    "keywords": []
  }
]

## bloom_level 기준
1 = 기억, 2 = 이해, 3 = 적용, 4 = 분석, 5 = 평가

## question_type
- multiple_choice: 4~5지선다
- short_answer: 단답형/주관식

## 난이도별 특성
- 난이도 1(하): 기본 개념. 단순 기억/이해.
- 난이도 2(중): 개념 응용, 약간의 추론.
- 난이도 3(상): 복합 개념, 심화 문제.`;
}

const diffLabel: Record<number, string> = { 1: '하', 2: '중', 3: '상' };

export async function POST(request: NextRequest) {
  try {
    const { subject, topic, keywords = [], difficulty = 2, count = 5 } = await request.json();

    if (!subject || !topic) {
      return NextResponse.json(
        { error: 'subject와 topic은 필수입니다.' },
        { status: 400 }
      );
    }

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: buildSystemPrompt(subject, topic, keywords),
      messages: [
        {
          role: 'user',
          content: `다음 조건으로 문제를 ${count}개 생성해줘.\n\n- 과목: ${subject}\n- 주제: ${topic}\n- 난이도: ${difficulty} (${diffLabel[difficulty] || '중'})\n- bloom_level 분포: 다양하게 섞어서\n\nJSON 배열로만 출력해.`,
        },
      ],
    });

    const textContent = message.content[0];
    if (textContent.type !== 'text') {
      return NextResponse.json({ error: 'API 응답 형식 오류' }, { status: 500 });
    }

    let jsonText = textContent.text.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const generated = JSON.parse(jsonText);

    return NextResponse.json({
      problems: generated,
      source: 'ai_generated',
      meta: { subject, topic, keywords, difficulty },
    });
  } catch (error) {
    console.error('토픽 기반 문제 생성 오류:', error);
    return NextResponse.json(
      { error: '문제 생성 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
