import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const PARSE_PROMPT = `너는 시험 문제 분석 전문가야. 학생이 틀린 문제 사진을 업로드하면, 문제를 정확히 파싱해서 구조화된 JSON으로 반환해.

## 파싱 규칙
1. 이미지에서 문제 텍스트, 선택지, 정답(표시되어 있다면)을 추출
2. 과목/단원은 문맥으로 추론 (수학, 과학, 사회, 영어, 국어 등)
3. 핵심 개념 키워드를 추출
4. 여러 문제가 보이면 모두 파싱

## 출력 형식
반드시 JSON으로만 출력. 마크다운 코드블록 없이 순수 JSON만.

{
  "problems": [
    {
      "question_text": "문제 본문 전체",
      "choices": ["①선택지1", "②선택지2", "③선택지3", "④선택지4", "⑤선택지5"],
      "marked_answer": "학생이 표시한 답 번호 (없으면 null)",
      "correct_answer": "정답 번호 (표시되어 있으면, 없으면 null)",
      "subject": "과목명",
      "topic": "단원/주제",
      "keywords": ["핵심개념1", "핵심개념2"],
      "difficulty_guess": 2
    }
  ],
  "overall_subject": "주 과목",
  "source_description": "시험지 종류 추정 (예: 중간고사, 모의고사, 워크북 등)"
}

## difficulty_guess 기준
1 = 단순 기억/이해 수준
2 = 개념 응용, 약간의 추론 필요
3 = 복합 개념, 심화 문제

## 주의사항
- 글씨가 흐리거나 잘려도 최대한 추론해서 복원
- choices가 없으면 (서술형) 빈 배열로
- 수식은 텍스트로 최대한 표현 (예: "2x + 3 = 7")
- 이미지에 문제가 아닌 내용(낙서, 메모)은 무시`;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const imageFile = formData.get('image') as File | null;

    if (!imageFile) {
      return NextResponse.json(
        { error: '이미지를 업로드해주세요.' },
        { status: 400 }
      );
    }

    // File → base64
    const bytes = await imageFile.arrayBuffer();
    const base64 = Buffer.from(bytes).toString('base64');

    // MIME type
    const mediaType = imageFile.type as
      | 'image/jpeg'
      | 'image/png'
      | 'image/gif'
      | 'image/webp';

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64,
              },
            },
            {
              type: 'text',
              text: PARSE_PROMPT,
            },
          ],
        },
      ],
    });

    const textContent = message.content[0];
    if (textContent.type !== 'text') {
      return NextResponse.json(
        { error: 'API 응답 형식 오류' },
        { status: 500 }
      );
    }

    // JSON 파싱 (Claude가 가끔 ```json 감싸기도 하므로 정리)
    let jsonText = textContent.text.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const parsed = JSON.parse(jsonText);

    return NextResponse.json(parsed);
  } catch (error) {
    console.error('이미지 파싱 오류:', error);
    return NextResponse.json(
      { error: '이미지 분석 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
