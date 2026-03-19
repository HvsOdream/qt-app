import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getServiceClient } from '@/lib/supabase';

export const maxDuration = 60;

// 학습자 컨텍스트 추론 (학년+과목으로 시험 스타일 유추)
function inferContext(grade: string, subject: string): string {
  const g = grade.toLowerCase();
  if (g.includes('고1') || g.includes('고2') || g.includes('고3')) {
    return `${grade} 학생 대상 내신/수능 준비용 문제. 교육과정 범위 내에서 출제.`;
  }
  if (g.includes('중')) {
    return `${grade} 학생 대상 내신 문제. 기초 개념 중심으로 출제.`;
  }
  if (g.includes('대학') || g.includes('전공')) {
    return `${grade} ${subject} 전공 수준 문제. 심화 개념과 응용 포함.`;
  }
  if (g.includes('기사') || g.includes('자격') || g.includes('시험') || g.includes('토익') || g.includes('토플')) {
    return `${grade} 자격시험 대비 문제. 실제 시험 출제 패턴과 유형에 맞춰 출제.`;
  }
  return `${subject} 학습자 대상 문제.`;
}

function buildSystemPrompt(grade: string, subject: string, topic: string, keywords: string[]): string {
  const kwText = keywords.length > 0 ? `\n핵심 키워드: ${keywords.join(', ')}` : '';
  const ctx = grade ? inferContext(grade, subject) : '';
  const ctxText = ctx ? `\n학습자 컨텍스트: ${ctx}` : '';
  return `너는 ${subject} 분야 문제 출제 전문가야.
주제: ${topic}${ctxText}${kwText}

## 출력 형식 (JSON 배열만, 설명 금지)
[
  {
    "question_text": "문제 내용 (전체 질문)",
    "choices": ["①선택지1", "②선택지2", "③선택지3", "④선택지4", "⑤선택지5"],
    "correct_answer": "①선택지1",
    "explanation": "정답 이유와 오답 분석",
    "subject": "${subject}",
    "topic": "${topic}",
    "keywords": ["핵심키워드1", "핵심키워드2"],
    "difficulty": 2,
    "bloom_level": 2,
    "question_type": "multiple_choice"
  }
]

## 문제 유형
- multiple_choice: 객관식 5지선다 (기본)
- short_answer: 단답형/주관식

## 난이도별 특성
- 난이도 1(하): 기본 개념. 단순 기억/이해.
- 난이도 2(중): 개념 응용, 약간의 추론.
- 난이도 3(상): 복합 개념, 심화 문제.`;
}

const diffLabel: Record<number, string> = { 1: '하', 2: '중', 3: '상' };

export async function POST(request: NextRequest) {
  try {
    const deviceId = request.headers.get('x-device-id') || 'unknown';
    const { grade = '', subject, topic, keywords = [], difficulty = 2, count = 5 } = await request.json();

    if (!subject || !topic) {
      return NextResponse.json(
        { error: 'subject와 topic은 필수입니다.' },
        { status: 400 }
      );
    }

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 4096,
      system: buildSystemPrompt(grade, subject, topic, keywords),
      messages: [
        {
          role: 'user',
          content: `다음 조건으로 문제를 ${count}개 생성해줘.\n\n${grade ? `- 학년/상황: ${grade}\n` : ''}- 과목: ${subject}\n- 주제: ${topic}\n- 난이도: ${difficulty} (${diffLabel[difficulty] || '중'})\n- bloom_level 분포: 다양하게 섞어서\n\nJSON 배열로만 출력해.`,
        },
      ],
    });

    const textContent = message.content[0];
    if (textContent.type !== 'text') {
      return NextResponse.json({ error: 'API 응답 형식 오류' }, { status: 500 });
    }

    let jsonText = textContent.text.trim();
    // JSON 파싱 4단계 강화
    jsonText = jsonText.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
    const arrayMatch = jsonText.match(/\[[\s\S]*\]/);
    if (arrayMatch) jsonText = arrayMatch[0];
    let generated: Record<string, unknown>[];
    try {
      generated = JSON.parse(jsonText);
    } catch {
      const objMatch = textContent.text.match(/\{[\s\S]*\}/);
      if (objMatch) { generated = [JSON.parse(objMatch[0])]; }
      else { throw new Error('JSON 파싱 실패: ' + textContent.text.slice(0, 100)); }
    }

    // ─── question_bank에 저장 ───
    let savedProblems = generated;
    try {
      const supabase = getServiceClient();
      const batchId = crypto.randomUUID();

      const makeRows = (includeDeviceId: boolean) => generated.map(q => ({
        question_text: q.question_text,
        choices: q.choices || [],
        correct_answer: q.correct_answer,
        explanation: (q.explanation as string) || null,
        subject: (q.subject as string) || subject,
        topic: (q.topic as string) || topic,
        keywords: (q.keywords as string[]) || keywords,
        difficulty: (q.difficulty as number) || difficulty,
        bloom_level: (q.bloom_level as number) || 2,
        question_type: (q.question_type as string) || 'multiple_choice',
        source: 'ai_topic',
        generation_batch_id: batchId,
        ...(includeDeviceId ? { device_id: deviceId } : {}),
      }));

      let { data: bankData, error: bankError } = await supabase
        .from('question_bank')
        .insert(makeRows(true))
        .select();

      // device_id 컬럼 미존재 시 컬럼 없이 재시도
      if (bankError && (bankError.message?.includes('device_id') || bankError.code === '42703')) {
        console.warn('device_id 컬럼 없음 — 재시도 (마이그레이션 필요)');
        const retry = await supabase.from('question_bank').insert(makeRows(false)).select();
        bankData = retry.data;
        bankError = retry.error;
      }

      if (bankError) {
        console.error('question_bank 저장 실패(generate-by-topic):', bankError);
      } else if (bankData) {
        savedProblems = bankData;
      }
    } catch (dbErr) {
      console.error('question_bank 저장 예외:', dbErr);
    }

    return NextResponse.json({
      problems: savedProblems,
      source: 'ai_generated',
      meta: { grade, subject, topic, keywords, difficulty },
    });
  } catch (error) {
    console.error('토픽 기반 문제 생성 오류:', error);
    return NextResponse.json(
      { error: '문제 생성 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
