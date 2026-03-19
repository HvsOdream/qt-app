import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

export async function POST(request: NextRequest) {
  try {
    const { keyword } = await request.json();
    if (!keyword?.trim()) return NextResponse.json({ keywords: [] });

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `학습 키워드 "${keyword}"와 관련된 핵심 개념 키워드 4개를 추천해줘.
JSON 배열로만 출력해. 예: ["키워드1", "키워드2", "키워드3", "키워드4"]
- 교과서 수준의 학습 개념으로
- 각 키워드는 2~6글자로 간결하게
- "${keyword}" 자체는 포함하지 말 것`,
      }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text : '[]';
    const match = text.match(/\[[\s\S]*\]/);
    const keywords: string[] = match ? JSON.parse(match[0]) : [];

    return NextResponse.json({ keywords });
  } catch (error) {
    console.error('expand-keywords 오류:', error);
    return NextResponse.json({ keywords: [] });
  }
}
