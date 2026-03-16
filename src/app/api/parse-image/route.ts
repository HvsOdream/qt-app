import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const PARSE_PROMPT = `너는 시험 문제 분석 전문가야. 학생이 시험지/문제지를 촬영한 사진을 분석해서 모든 문제를 파싱한다.

## 핵심 임무
1. 사진 속 **모든 문제**를 번호 순서대로 파싱
2. 각 문제에서 **학생이 고른 답**(marked_answer)과 **정답**(correct_answer)을 구분
3. 채점 표시(O, X, 동그라미, 체크, 빨간 펜 등)를 분석해서 맞았는지 틀렸는지 판별

## 채점 표시 판별 규칙
- 문제 번호에 동그라미/체크 = 틀린 문제 표시일 가능성 높음 (시험지에서 틀린 문제에 표시하는 습관)
- 선택지에 동그라미 = 학생이 고른 답 (marked_answer)
- X표시 = 오답 표시
- 빨간 펜/형광펜 표시도 채점 힌트로 활용
- 판별이 애매하면 is_wrong: null로 표시

## 출력 형식
반드시 JSON으로만 출력. 마크다운 코드블록 없이 순수 JSON만.

{
  "problems": [
    {
      "question_number": "01",
      "question_text": "문제 본문 전체",
      "choices": ["①선택지1", "②선택지2", "③선택지3", "④선택지4"],
      "marked_answer": "학생이 고른 답 번호 (없으면 null)",
      "correct_answer": "정답 번호 (추론 가능하면, 없으면 null)",
      "is_wrong": true,
      "subject": "과목명",
      "topic": "단원/주제",
      "keywords": ["핵심개념1", "핵심개념2"],
      "difficulty_guess": 2
    }
  ],
  "overall_subject": "주 과목",
  "source_description": "시험지 종류 추정 (예: 기출유형, 모의고사, 자격증 등)"
}

## is_wrong 판별
- true = 확실히 틀린 문제 (X표시, 오답 체크, 학생답 ≠ 정답)
- false = 확실히 맞은 문제
- null = 판별 불가 (채점 표시 없음)

## difficulty_guess 기준
1 = 단순 기억/이해 수준
2 = 개념 응용, 약간의 추론 필요
3 = 복합 개념, 심화 문제

## 주의사항
- 글씨가 흐리거나 잘려도 최대한 추론해서 복원
- choices가 없으면 (서술형) 빈 배열로
- 수식은 텍스트로 최대한 표현
- 이미지에 문제가 아닌 내용(낙서, 메모)은 무시
- 정답을 모르면 correct_answer: null, 학습 내용으로 추론 가능하면 채워`;

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

    // detail 파라미터: low=토큰 절약(고정 85토큰), high=고해상도
    // 시험지 텍스트 인식에는 low로도 충분
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
