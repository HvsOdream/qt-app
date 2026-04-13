// POST /api/generate-similar
// wrong_note 항목 기반 유사문제 생성 → wrong_note에 저장 (source='generated')
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getServiceClient } from '@/lib/supabase';

const SYSTEM_PROMPT = `너는 시험 문제 출제 전문가야. 학생이 틀린 문제를 기반으로 같은 개념의 유사 문제를 생성한다.

## 출제 원칙
- 원본 문제와 같은 개념/유형이지만 다른 수치/상황으로 변형
- 하나의 명확한 정답만 존재
- 매력적 오답은 학생의 흔한 오개념에서 설계
- 해설은 "왜 정답인지" + "왜 오답인지" + "원본 문제와의 관계" 포함

## 출력 형식
반드시 JSON 배열로 출력. 마크다운 코드블록 없이 순수 JSON만.

객관식:
{
  "question_text": "문제 본문",
  "choices": ["①선택지1", "②선택지2", "③선택지3", "④선택지4"],
  "correct_answer": "1",
  "explanation": "해설",
  "subject": "과목",
  "topic": "단원",
  "question_type": "multiple_choice"
}

주관식:
{
  "question_text": "문제 본문",
  "choices": [],
  "correct_answer": "-6",
  "explanation": "해설",
  "subject": "수학",
  "topic": "일차부등식",
  "question_type": "short_answer"
}

## question_type 변환 규칙
- 원본 multiple_choice → 유사문제도 multiple_choice
- 원본 short_answer/essay + 수학/과학 → multiple_choice로 변환 (모바일 입력 편의)
- 원본 short_answer + 국어/영어/사회 → short_answer 유지

## correct_answer 규칙
- multiple_choice: 순수 숫자 문자열 "1","2","3","4"
- short_answer: 정답 텍스트 (예: "-6", "a = 3")

## 수식 표기
- 부등호: ＜ ＞ ≤ ≥ (전각/유니코드) 사용 — HTML 태그 < > 금지
- 분수: a/b, 거듭제곱: a^n, 루트: √`;

export async function POST(request: NextRequest) {
  try {
    const { originalItem, device_id, count = 3, difficulty } = await request.json() as {
      originalItem: {
        id: string;
        subject?: string;
        topic?: string;
        question_text: string;
        choices?: string[];
        question_type?: string;
        correct_answer?: string;
      };
      device_id: string;
      count?: number;
      difficulty?: number; // 1=쉽게, 2=비슷하게, 3=어렵게
    };

    if (!originalItem?.question_text || !device_id) {
      return NextResponse.json({ error: 'originalItem, device_id 필요' }, { status: 400 });
    }

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const diffLabel: Record<number, string> = { 1: '쉽게', 2: '비슷하게', 3: '어렵게' };
    const diffInstruction = difficulty
      ? `난이도는 원본보다 ${diffLabel[difficulty] || '비슷하게'} 출제해.`
      : '난이도는 원본과 비슷하게 유지해.';

    const questionType = originalItem.question_type ||
      (originalItem.choices?.length ? 'multiple_choice' : 'short_answer');
    const typeLabel: Record<string, string> = {
      multiple_choice: '객관식', short_answer: '주관식 단답형', essay: '서술형',
    };

    const userPrompt = `학생이 다음 문제를 틀렸어. 같은 개념의 유사 문제 ${count}개를 생성해줘.

## 원본 문제
- 과목: ${originalItem.subject || '알 수 없음'}
- 단원: ${originalItem.topic || '알 수 없음'}
- 유형: ${typeLabel[questionType] || questionType}
- 문제: ${originalItem.question_text}
${originalItem.choices?.length ? `- 선택지: ${originalItem.choices.join(' / ')}` : ''}
${originalItem.correct_answer ? `- 정답: ${originalItem.correct_answer}` : ''}

## 요구사항
- ${diffInstruction}
- 같은 개념이지만 숫자/상황을 바꿔 출제
- 해설에서 원본 문제와의 연관성 언급

JSON 배열로만 출력.`;

    const estimatedTokens = Math.min(4096, Math.max(1500, count * 600));

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: estimatedTokens,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
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

    // ─── wrong_note에 저장 (source='generated', parent_id=원본 id) ───
    const supabase = getServiceClient();
    const rows = generated.map((q: Record<string, unknown>) => ({
      device_id,
      subject:        q.subject || originalItem.subject || null,
      topic:          q.topic || originalItem.topic || null,
      question_text:  q.question_text,
      choices:        q.choices || [],
      question_type:  q.question_type || 'multiple_choice',
      correct_answer: q.correct_answer,
      explanation:    q.explanation || null,
      source:         'generated',
      parent_id:      originalItem.id,
      times_wrong:    0,
      times_correct:  0,
      mastered:       false,
    }));

    const { data: savedItems, error: saveErr } = await supabase
      .from('wrong_note')
      .insert(rows)
      .select();

    if (saveErr) {
      console.error('wrong_note 저장 실패:', saveErr);
      return NextResponse.json({ items: generated });
    }

    return NextResponse.json({ items: savedItems });
  } catch (error) {
    console.error('유사문제 생성 오류:', error);
    return NextResponse.json({ error: '유사문제 생성 오류' }, { status: 500 });
  }
}
