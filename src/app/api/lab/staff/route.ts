// 조교 PC 화면용 API — 교수자 계정만
// GET  : 블록 목록, 블록별 참여자 상태(조건은 내려주지 않는다), 설문 문항 수
// POST : create_block / open_block / close_block / gen_codes / reset_pin / fix / censor / import_items
import { NextRequest, NextResponse } from 'next/server';
import { randomInt } from 'crypto';
import { getAuthUser, isTeacher } from '@/lib/teacher';
import { codeEmail, logEvent, surveyItems, LabSession } from '@/lib/lab';

const pin = () => String(randomInt(0, 1000000)).padStart(6, '0');
const shuffle = <T,>(a: T[]) => { for (let i = a.length - 1; i > 0; i -= 1) { const j = randomInt(0, i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export async function GET(req: NextRequest) {
  const { user, supabase } = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 });
  if (!isTeacher(user)) return NextResponse.json({ error: '권한이 없습니다' }, { status: 403 });

  const [{ data: blocks }, { data: people }, { data: sessions }, items] = await Promise.all([
    supabase.from('lab_blocks').select('*').order('created_at', { ascending: false }),
    supabase.from('lab_participants').select('user_id, block_id, research_code, survey_done_at').not('research_code', 'is', null).order('research_code'),
    supabase.from('lab_sessions').select('id, user_id, track, plan_minutes, plan_at, checkout_at, checkout_source').order('plan_at'),
    surveyItems(supabase),
  ]);
  const lastOf = new Map<string, NonNullable<typeof sessions>[number]>();
  (sessions || []).forEach((s) => lastOf.set(s.user_id, s));

  const scales: Record<string, number> = {};
  items.forEach((i) => { const k = `${i.phase}:${i.scale}${i.also_out ? ' (퇴실 때도)' : ''}`; scales[k] = (scales[k] || 0) + 1; });

  return NextResponse.json({
    blocks: (blocks || []).map((b) => ({
      ...b,
      participants: (people || []).filter((p) => p.block_id === b.id).map((p) => {
        const s = lastOf.get(p.user_id);
        return {
          code: p.research_code,
          survey_done: !!p.survey_done_at,
          session_id: s?.id || null,
          track: s?.track || null,
          plan_at: s?.plan_at || null,
          plan_minutes: s?.plan_minutes ?? null,
          checkout_at: s?.checkout_at || null,
          checkout_source: s?.checkout_source || null,
          status: !s ? (p.survey_done_at ? '설문 완료' : '입실 전') : s.checkout_at ? '퇴실' : '공부 중',
        };
      }),
    })),
    survey: { total: items.length, in: items.filter((i) => i.phase === 'in').length, scales },
  });
}

export async function POST(req: NextRequest) {
  const { user, supabase } = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 });
  if (!isTeacher(user)) return NextResponse.json({ error: '권한이 없습니다' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const now = new Date().toISOString();

  if (body.action === 'create_block') {
    const label = String(body.label || '').trim().slice(0, 60);
    if (!label) return NextResponse.json({ error: '블록 이름을 적어 주세요' }, { status: 400 });
    const { error } = await supabase.from('lab_blocks').insert({ label });
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true });
  }
  if (body.action === 'open_block' || body.action === 'close_block') {
    const patch = body.action === 'open_block' ? { opened_at: now, closed_at: null } : { closed_at: now };
    const { error } = await supabase.from('lab_blocks').update(patch).eq('id', body.block_id);
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true });
  }

  // 익명 코드 일괄 생성: 블록 안에서 조건을 A·B·C 고르게 섞어 배정한다. PIN은 이 응답에서 한 번만 보여 준다.
  if (body.action === 'gen_codes') {
    const n = Math.min(60, Math.max(1, Math.round(Number(body.count))));
    const { count } = await supabase.from('lab_participants').select('user_id', { count: 'exact', head: true }).not('research_code', 'is', null);
    const start = (count || 0) + 1;
    const conds = shuffle(Array.from({ length: n }, (_, i) => ['A', 'B', 'C'][i % 3]));
    const made: { code: string; pin: string }[] = [];
    for (let i = 0; i < n; i += 1) {
      const code = `R-${String(start + i).padStart(3, '0')}`;
      const p = pin();
      const { data, error } = await supabase.auth.admin.createUser({ email: codeEmail(code), password: p, email_confirm: true });
      if (error || !data.user) return NextResponse.json({ error: `${code} 생성 실패: ${error?.message}`, made }, { status: 500 });
      const { error: e2 } = await supabase.from('lab_participants')
        .insert({ user_id: data.user.id, condition: conds[i], block_id: body.block_id, research_code: code });
      if (e2) return NextResponse.json({ error: e2.message, made }, { status: 500 });
      made.push({ code, pin: p });
    }
    return NextResponse.json({ made });
  }
  if (body.action === 'reset_pin') {
    const { data: p } = await supabase.from('lab_participants').select('user_id').eq('research_code', body.code).maybeSingle();
    if (!p) return NextResponse.json({ error: '없는 코드예요' }, { status: 404 });
    const newPin = pin();
    const { error } = await supabase.auth.admin.updateUserById(p.user_id, { password: newPin });
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ made: [{ code: body.code, pin: newPin }] });
  }

  // 미퇴실 처리: fix = 퇴실 시각 보정(HH:MM), censor = 종료 처리(완주)
  if (body.action === 'fix' || body.action === 'censor') {
    const { data: s } = await supabase.from('lab_sessions').select('*').eq('id', body.session_id).maybeSingle();
    const session = s as LabSession | null;
    if (!session) return NextResponse.json({ error: '세션이 없어요' }, { status: 404 });
    if (session.checkout_at) return NextResponse.json({ error: '이미 퇴실한 세션이에요' }, { status: 409 });
    let at = new Date();
    if (body.action === 'fix') {
      const m = String(body.time || '').match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return NextResponse.json({ error: '시각을 시:분으로 적어 주세요' }, { status: 400 });
      // 한국 시각 기준으로 입실한 날의 그 시각
      const planKst = new Date(new Date(session.plan_at).getTime() + 9 * 3600000);
      at = new Date(Date.UTC(planKst.getUTCFullYear(), planKst.getUTCMonth(), planKst.getUTCDate(), Number(m[1]) - 9, Number(m[2])));
      if (at.getTime() < new Date(session.plan_at).getTime() || at.getTime() > Date.now()) {
        return NextResponse.json({ error: '입실 뒤부터 지금 사이의 시각이어야 해요' }, { status: 400 });
      }
    }
    const kind = body.action === 'fix' ? 'fix' : 'censor';
    const { error } = await supabase.from('lab_sessions')
      .update({ checkout_at: at.toISOString(), checkout_source: kind }).eq('id', session.id).is('checkout_at', null);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const stayed = Math.round((at.getTime() - new Date(session.plan_at).getTime()) / 6000) / 10;
    await logEvent(supabase, session, 'staff_fix', { kind, minutes_stayed: stayed, checkout_at: at.toISOString() });
    return NextResponse.json({ ok: true });
  }

  // 설문 문항 붙여 넣기: 한 줄에 「척도, 번호, 유형, 역채점(0/1), 퇴실 때도(0/1), 왼쪽 끝 말, 오른쪽 끝 말, 문항 글」을 탭으로 구분
  if (body.action === 'import_items') {
    const lines = String(body.text || '').split('\n').map((l) => l.trim()).filter(Boolean);
    const rows = [];
    for (const [idx, line] of lines.entries()) {
      const c = line.split('\t');
      if (c.length < 8) return NextResponse.json({ error: `${idx + 1}번째 줄: 칸이 8개여야 해요` }, { status: 400 });
      const [scale, no, type, rev, out, minL, maxL, ...rest] = c;
      if (!['likert5', 'likert6', 'likert7', 'number', 'date', 'yesno'].includes(type)) {
        return NextResponse.json({ error: `${idx + 1}번째 줄: 유형 ${type}은 쓸 수 없어요` }, { status: 400 });
      }
      rows.push({
        scale: scale.trim(), item_no: Number(no), response_type: type, reverse: rev === '1', also_out: out === '1',
        min_label: minL || null, max_label: maxL || null, text_ko: rest.join(' ').trim(), phase: 'in',
        sort: Number(body.sort_base || 100) + idx,
      });
    }
    if (!rows.length) return NextResponse.json({ error: '붙여 넣은 내용이 없어요' }, { status: 400 });
    const { error } = await supabase.from('lab_survey_items').upsert(rows, { onConflict: 'scale,item_no' });
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true, count: rows.length });
  }

  return NextResponse.json({ error: '알 수 없는 요청' }, { status: 400 });
}
