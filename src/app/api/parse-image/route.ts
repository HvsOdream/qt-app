import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const maxDuration = 60;

const PARSE_PROMPT = `너는 시험 문제 분석 전문가야. 학생이 문제 사진을 업로드하면, 문제를 정확히 파싱해서 구조화된 JSON으로 반환해.

## 파싱 규칙
1. 이미지에서 문제 텍스트, 선택지를 추출
2. 과목/단원은 **이미지에 명시된 경우에만** 채운다. 명시되어 있지 않으면 빈 문자열("")로 둔다 — 사용자가 직접 입력함
3. 핵심 개념 키워드를 추출
4. 여러 문제가 보이면 모두 파싱

## ★ subject/topic 추출 규칙 (오작동 방지)
- **subject**: 시험지 머리말이나 단원 표지에 명시된 과목명만 사용 (예: "수학", "정보처리기능사", "ADsP", "TOEIC")
- **topic**: 챕터 번호·단원 제목·소제목 등 명시적으로 보이는 텍스트만 사용
- ⚠️ **선택지(①, ②, ③, ④, ⑤)의 텍스트를 절대 topic에 넣지 마라**
- ⚠️ 보기 1번이 "데이터 시각화"라고 해서 topic이 "데이터 시각화"가 되면 안 된다 — 보기는 답일 뿐 단원이 아니다
- 과목/단원이 사진에 명시되지 않았거나 확신이 낮으면 빈 문자열("")로 두고, overall_subject만 시험지 종류로 추정 (예: "ADsP", "수능 모의고사", "내신 시험지")

## ★ 정답 추론 (가장 중요)
- 시험지에 정답이 표시되어 있으면 그것을 사용
- **정답이 표시되어 있지 않더라도, 문제 내용과 선택지를 분석하여 반드시 정답을 추론해서 correct_answer에 넣어라**
- 과목 지식을 활용하여 논리적으로 정답을 판단
- correct_answer는 절대 null로 두지 마라. 반드시 정답 번호를 숫자로 넣어라 (예: "1", "2", "3", "4", "5")
- 확신이 낮아도 가장 가능성 높은 답을 선택하고, confidence 필드에 확신도를 표시

## ★ 해설(explanation) 작성 규칙
- **반드시 explanation 필드를 채워라.** 빈 문자열이나 null 금지.
- 학습자가 "왜 이 답이 정답인지" 즉시 이해할 수 있게 작성
- 객관식이면 다음을 모두 포함:
  1. **정답 풀이**: 왜 ②번이 정답인지 (개념·논리)
  2. **오답 분석**: 다른 보기가 왜 틀렸는지 (간단히, 1줄씩)
  3. **핵심 개념**: 이 문제가 묻는 핵심 한 줄 요약
- 주관식/서술형이면 풀이 과정 + 정답 + 핵심 개념
- 분량: 200~400자 (너무 길지 않게, 한눈에 들어오도록)
- 어조: 학생에게 친절하게 설명하는 어투. 딱딱한 답안지 X.

## 출력 형식
반드시 JSON으로만 출력. 마크다운 코드블록 없이 순수 JSON만.

{
  "problems": [
    {
      "question_text": "문제 본문 전체",
      "question_type": "multiple_choice 또는 short_answer 또는 essay",
      "choices": ["①선택지1", "②선택지2", "③선택지3", "④선택지4", "⑤선택지5"],
      "marked_answer": "학생이 표시한 답 번호 (없으면 null)",
      "correct_answer": "정답 번호 (반드시 숫자 문자열: '1','2','3','4','5') 또는 주관식 정답 텍스트",
      "confidence": "정답 확신도 (high/medium/low)",
      "explanation": "정답 해설 — 왜 정답인지 + 다른 보기는 왜 오답인지 + 핵심 개념. 200~400자.",
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

## question_type 분류 규칙
- **multiple_choice**: 선택지(①②③④⑤)가 있는 객관식
- **short_answer**: "구하시오", "값을 구하시오", "쓰시오" 등 단답형 주관식 (정답이 숫자나 짧은 문구)
- **essay**: "서술하시오", "설명하시오", "과정을 쓰시오" 등 긴 서술형
- 선택지 없이 "구하시오"로 끝나는 수학 문제 → short_answer
- choices: 객관식이면 선택지 배열, 주관식/서술형이면 빈 배열 []
- correct_answer: 객관식은 숫자 문자열("1","2"...), 주관식은 정답 텍스트 (예: "-6", "a = 3")

## 주의사항
- 글씨가 흐리거나 잘려도 최대한 추론해서 복원
- choices가 없으면 (서술형/주관식) 빈 배열로
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
