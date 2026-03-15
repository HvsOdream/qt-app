import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getServiceClient } from '@/lib/supabase';

const SYSTEM_PROMPT = `너는 중학교 과학 문제 출제 전문가야. 2022 개정 교육과정 기준으로 중학교 2학년 과학 문제를 생성한다.

## 출제 원칙
- 교과서 본문 수준의 정확한 과학 지식 기반
- 하나의 명확한 정답만 존재
- 매력적 오답은 학생의 흔한 오개념에서 설계
- 해설은 "왜 정답인지" + "왜 오답인지" 모두 포함
- 한국 중학교 지필평가(중간/기말) 스타일

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
    "image_type": "none"
  }
]

## bloom_level 기준
1 = 기억 (용어, 정의 재인)
2 = 이해 (개념 설명, 비교)
3 = 적용 (계산, 실험 해석)
4 = 분석 (자료 비교, 변인 파악)
5 = 평가 (옳고 그름 판단)

## question_type
- multiple_choice: 5지선다
- box_select: 보기형 (ㄱ,ㄴ,ㄷ 조합)

## 난이도별 특성
- 난이도 1(하): 교과서 본문에서 직접 답을 찾을 수 있는 수준. 단순 기억/이해.
- 난이도 2(중): 개념을 응용하거나 약간의 계산/추론 필요.
- 난이도 3(상): 복합 개념, 자료 분석, 실험 설계 수준.`;

const diffLabel: Record<number, string> = { 1: '하', 2: '중', 3: '상' };

export async function POST(request: NextRequest) {
  try {
    const { unitId, difficulty, count = 5 } = await request.json();

    if (!unitId || !difficulty) {
      return NextResponse.json(
        { error: 'unitId와 difficulty는 필수입니다.' },
        { status: 400 }
      );
    }

    const supabase = getServiceClient();

    // 1. DB에서 먼저 조회
    const { data: existing } = await supabase
      .from('problems')
      .select('*')
      .eq('unit_id', unitId)
      .eq('difficulty', difficulty)
      .limit(count);

    if (existing && existing.length >= count) {
      return NextResponse.json({ problems: existing, source: 'db' });
    }

    // 2. 부족하면 API 호출
    const needed = count - (existing?.length || 0);

    // 단원 정보 조회
    const { data: unit } = await supabase
      .from('units')
      .select('code, title')
      .eq('id', unitId)
      .single();

    if (!unit) {
      return NextResponse.json(
        { error: '해당 단원을 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `다음 조건으로 과학 문제를 ${needed}개 생성해줘.\n\n- 교과서: 천재교과서 과학2 (정대홍, 2022개정)\n- 단원: ${unit.title} (${unit.code})\n- 난이도: ${difficulty} (${diffLabel[difficulty]})\n- bloom_level 분포: 다양하게 섞어서\n\nJSON 배열로만 출력해.`,
        },
      ],
    });

    // 3. 파싱
    const textContent = message.content[0];
    if (textContent.type !== 'text') {
      return NextResponse.json(
        { error: 'API 응답 형식 오류' },
        { status: 500 }
      );
    }

    const generated = JSON.parse(textContent.text);

    // 4. DB 저장
    const toInsert = generated.map(
      (q: {
        question_type: string;
        bloom_level: number;
        question_text: string;
        choices: string[];
        correct_answer: string;
        explanation: string;
        image_type?: string;
      }) => ({
        unit_id: unitId,
        difficulty,
        question_type: q.question_type,
        bloom_level: q.bloom_level,
        question_text: q.question_text,
        choices: q.choices,
        correct_answer: q.correct_answer,
        explanation: q.explanation,
        image_svg: null,
        image_type: q.image_type || 'none',
        source: 'ai_generated',
      })
    );

    await supabase.from('problems').insert(toInsert);

    // 5. 기존 + 새 문제 합쳐서 응답
    const all = [...(existing || []), ...toInsert];
    return NextResponse.json({
      problems: all.slice(0, count),
      source: existing?.length ? 'mixed' : 'generated',
    });
  } catch (error) {
    console.error('문제 생성 오류:', error);
    return NextResponse.json(
      { error: '문제 생성 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
