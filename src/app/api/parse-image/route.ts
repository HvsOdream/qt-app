import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const PARSE_PROMPT = `너는 시험 문제 분석 전문가야. 학생이 시험지/문제지를 촬영한 사진을 분석해서 모든 문제를 파싱한다.

## 핵심 임무
1. 사진 속 **완전한 문제**만 번호 순서대로 파싱
2. 각 문제에서 **학생이 고른 답**(marked_answer)과 **정답**(correct_answer)을 구분
3. 채점 표시를 분석하되, 확신이 낮으면 is_wrong: null로 남겨 (사용자가 직접 수정함)

## 잘린 문제 처리
- 사진 상단/하단 가장자리에 선택지만 보이거나, 문제 본문이 잘려서 전체 내용을 알 수 없는 경우 → **파싱하지 말 것**
- 문제 번호 + 본문 + 선택지가 모두 보여야 유효한 문제

## 채점 표시 판별 규칙
- 선택지에 동그라미/밑줄 = 학생이 고른 답 (marked_answer) 또는 채점자가 표시한 정답일 수 있음
- ⚠️ 빨간 펜 동그라미가 "학생의 원래 답"인지 "채점자가 정답을 표시한 것"인지 구분이 어려우면 is_wrong: null
- X표시가 문제 옆에 있으면 = 오답 표시
- 문제 번호에 동그라미 = 단순 표시이므로 is_wrong 판별에 사용하지 말 것
- 정답을 모를 때는 해당 분야 지식으로 추론하여 correct_answer를 채워

## 매칭형/조합형 문제 처리
- "다음 중 옳은 것끼리 짝지어진 것은?" 같은 조합형 문제:
  - choices에 "①가,나", "②나,다" 등 조합 선택지를 그대로 기록
  - 개별 항목(가, 나, 다, 라)의 내용도 question_text에 포함
- "보기"가 있는 문제는 보기 내용을 question_text에 포함

## 과목/출처 판별
- 페이지 상단 제목, 하단 페이지 번호 옆 과목명(예: "1과목 _ 데이터 이해"), 문제지 헤더를 확인
- "기출유형 문제", "ADsP", "빅데이터분석기사" 등 시험 종류가 보이면 source_description에 반영
- overall_subject는 가능한 구체적으로 (예: "데이터베이스" 대신 "ADsP 데이터 이해")

## 출력 형식
반드시 JSON으로만 출력. 마크다운 코드블록 없이 순수 JSON만.

{
  "problems": [
    {
      "question_number": "01",
      "question_text": "문제 본문 전체 (보기/조건 포함)",
      "choices": ["①선택지1", "②선택지2", "③선택지3", "④선택지4"],
      "marked_answer": "학생이 고른 답 번호 (없으면 null)",
      "correct_answer": "정답 번호 (추론 가능하면, 없으면 null)",
      "is_wrong": null,
      "subject": "과목명",
      "topic": "단원/주제",
      "keywords": ["핵심개념1", "핵심개념2"],
      "difficulty_guess": 2
    }
  ],
  "overall_subject": "주 과목 (가능한 구체적으로)",
  "source_description": "시험지 종류 (예: ADsP 기출유형, 정보처리기사 모의고사 등)"
}

## is_wrong 판별
- true = 확실히 틀린 문제 (X표시가 명확하거나, 학생답 ≠ 정답이 확실)
- false = 확실히 맞은 문제
- null = 판별 불가 또는 확신 낮음 (기본값으로 사용, 사용자가 직접 수정)

## difficulty_guess 기준
1 = 단순 기억/이해 수준
2 = 개념 응용, 약간의 추론 필요
3 = 복합 개념, 심화 문제

## 주의사항
- 글씨가 흐리거나 살짝 잘려도 추론 가능하면 복원
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
