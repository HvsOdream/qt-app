import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const PARSE_PROMPT = `너는 시험 문제 분석 전문가야. 학생이 문제 사진을 업로드하면, 문제를 정확히 파싱해서 구조화된 JSON으로 반환해.

## 파싱 규칙
1. 이미지에서 문제 텍스트, 선택지를 추출
2. 과목/단원은 문맥으로 추론 (수학, 과학, 사회, 영어, 국어 등)
3. 핵심 개념 키워드를 추출
4. 여러 문제가 보이면 모두 파싱

## ★ 정답 추론 (가장 중요)
- 시험지에 정답이 표시되어 있으면 그것을 사용
- **정답이 표시되어 있지 않더라도, 문제 내용과 선택지를 분석하여 반드시 정답을 추론해서 correct_answer에 넣어라**
- 과목 지식을 활용하여 논리적으로 정답을 판단
- correct_answer는 절대 null로 두지 마라. 반드시 정답 번호를 숫자로 넣어라 (예: "1", "2", "3", "4", "5")
- 확신이 낮아도 가장 가능성 높은 답을 선택하고, confidence 필드에 확신도를 표시

## 출력 형식
반드시 JSON으로만 출력. 마크다운 코드블록 없이 순수 JSON만.

{
  "problems": [
    {
      "question_text": "문제 본문 전체",
      "choices": ["①선택지1", "②선택지2", "③선택지3", "④선택지4", "⑤선택지5"],
      "marked_answer": "학생이 표시한 답 번호 (없으면 null)",
      "correct_answer": "정답 번호 (반드시 숫자 문자열: '1','2','3','4','5')",
      "confidence": "정답 확신도 (high/medium/low)",
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
- 수식에서 부등호는 반드시 ＜ ＞ ≤ ≥ (전각/유니코드)로 표현. HTML 태그로 해석될 수 있는 < > 사용 금지
- 분수는 a/b, 거듭제곱은 a^n, 루트는 √ 기호 사용
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
