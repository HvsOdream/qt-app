// PATCH /api/wrong-note/[id]  — subject/topic/user_note 변경
// DELETE /api/wrong-note/[id] — 항목 + 자식 유사문제 cascade 삭제
import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 });

  const body = await request.json() as {
    subject?: string | null;
    topic?: string | null;
    user_note?: string | null;
  };

  const updates: Record<string, string | null> = {};
  if ('subject'   in body) updates.subject   = body.subject?.trim() || null;
  if ('topic'     in body) updates.topic     = body.topic?.trim() || null;
  // user_note는 빈 문자열도 허용 (사용자가 메모 비우기)
  if ('user_note' in body) updates.user_note = body.user_note ?? null;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: '변경할 필드 없음' }, { status: 400 });
  }

  const supabase = getServiceClient();

  // 본인 업데이트
  const { error: selfErr } = await supabase
    .from('wrong_note')
    .update(updates)
    .eq('id', id);
  if (selfErr) return NextResponse.json({ error: selfErr.message }, { status: 500 });

  // 카테고리 변경(subject/topic)이면 자식까지 동기화 — user_note는 자식 동기화 X
  const categoryUpdates: Record<string, string | null> = {};
  if ('subject' in updates) categoryUpdates.subject = updates.subject;
  if ('topic'   in updates) categoryUpdates.topic   = updates.topic;
  if (Object.keys(categoryUpdates).length > 0) {
    await supabase
      .from('wrong_note')
      .update(categoryUpdates)
      .eq('parent_id', id);
  }

  return NextResponse.json({ ok: true, updated: updates });
}

export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 });

  const supabase = getServiceClient();

  // 자식 유사문제 먼저 cascade 삭제
  await supabase.from('wrong_note').delete().eq('parent_id', id);

  // 본인 삭제
  const { error } = await supabase.from('wrong_note').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
