'use client';

// 진행자(조교) PC 화면 — 교수자 계정만
// 블록 열고 닫기, 익명 코드 만들기, 입실 목록(조건은 보이지 않는다), 미퇴실 처리, 로그 내보내기, 설문 문항 넣기
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

interface Person {
  code: string; survey_done: boolean; session_id: string | null; track: string | null;
  plan_at: string | null; plan_minutes: number | null; checkout_at: string | null; checkout_source: string | null; status: string;
}
interface Block { id: string; label: string; opened_at: string | null; closed_at: string | null; participants: Person[] }
interface Overview { blocks: Block[]; survey: { total: number; in: number; scales: Record<string, number> } }

const NAVY = '#1B3F8B';
const hhmm = (iso: string | null) => iso
  ? new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
const SOURCE: Record<string, string> = { button: '', fix: ' (보정)', censor: ' (종료 처리)' };

export default function StaffPage() {
  const [state, setState] = useState<'loading' | 'denied' | 'ready'>('loading');
  const [data, setData] = useState<Overview | null>(null);
  const [msg, setMsg] = useState('');
  const [label, setLabel] = useState('');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [sheet, setSheet] = useState<{ block: string; rows: { code: string; pin: string }[] } | null>(null);
  const [importText, setImportText] = useState('');
  const [busy, setBusy] = useState(false);
  const [fixFor, setFixFor] = useState<{ id: string; time: string } | null>(null); // 퇴실 보정 입력 중인 세션
  const [censorFor, setCensorFor] = useState(''); // 종료 처리 확인 중인 세션

  const call = useCallback(async (init?: RequestInit) => {
    const { data: s } = await supabase.auth.getSession();
    const res = await fetch('/api/lab/staff', {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.session?.access_token || ''}` },
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
  }, []);

  const load = useCallback(async () => {
    const r = await call();
    if (r.status === 401 || r.status === 403) { setState('denied'); return; }
    if (r.ok) { setData(r.json); setState('ready'); } else setMsg(r.json.error || '불러오지 못했어요');
  }, [call]);

  useEffect(() => {
    const first = setTimeout(() => { void load(); }, 0);
    const t = setInterval(() => { void load(); }, 20000); // 입실 목록은 20초마다 새로 받는다
    return () => { clearTimeout(first); clearInterval(t); };
  }, [load]);

  const act = async (body: Record<string, unknown>) => {
    setBusy(true); setMsg('');
    const r = await call({ method: 'POST', body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) { setMsg(r.json.error || '처리하지 못했어요'); return null; }
    await load();
    return r.json;
  };

  // 리허설용: PIN 없이 참여자 계정으로 들어간다. 진행자 로그인 정보는 돌아올 때 쓰도록 잠시 맡겨 둔다
  const enterAs = async (code: string) => {
    const { data: cur } = await supabase.auth.getSession();
    const r = await act({ action: 'enter_as', code });
    if (!r?.token_hash || !cur.session) return;
    localStorage.setItem('lab_staff_return', JSON.stringify({ access_token: cur.session.access_token, refresh_token: cur.session.refresh_token }));
    const { error } = await supabase.auth.verifyOtp({ token_hash: r.token_hash, type: 'magiclink' });
    if (error) { localStorage.removeItem('lab_staff_return'); setMsg(`들어가지 못했어요: ${error.message}`); return; }
    window.location.href = '/lab';
  };

  const download = async (kind: string) => {
    const { data: s } = await supabase.auth.getSession();
    const res = await fetch(`/api/lab/export?kind=${kind}`, { headers: { Authorization: `Bearer ${s.session?.access_token || ''}` } });
    if (!res.ok) { setMsg('내보내기에 실패했어요'); return; }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a'); a.href = url; a.download = `lab_${kind}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (state === 'loading') return <div className="min-h-screen flex items-center justify-center text-sm text-slate-500">불러오는 중…</div>;
  if (state === 'denied') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-center">
        <div className="text-lg font-bold">진행자 계정으로 로그인해 주세요</div>
        <Link href="/" className="underline text-sm text-slate-500">로그인하러 가기</Link>
      </div>
    );
  }

  const btn = 'h-9 px-3 rounded-lg text-[13px] font-bold border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50';
  return (
    <div className="min-h-screen bg-[#F4F6FA] text-[#16213A]">
      <div className="max-w-[1100px] mx-auto px-6 py-8 flex flex-col gap-6 print:hidden">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-2xl font-extrabold">자율 학습실 진행자 화면</div>
            <div className="text-sm text-slate-500">참여자의 화면 종류(조건)는 이 화면에 나오지 않습니다.</div>
          </div>
          <div className="flex gap-2">
            <button className={btn} onClick={() => download('events')}>이벤트 CSV</button>
            <button className={btn} onClick={() => download('sessions')}>세션 CSV</button>
            <button className={btn} onClick={() => download('participants')}>참여자 CSV</button>
          </div>
        </div>
        {msg && <div role="alert" className="rounded-xl px-4 py-3 text-sm bg-red-50 text-red-700">{msg}</div>}

        <div className="bg-white rounded-2xl p-5 flex items-end gap-3 shadow-sm">
          <label className="flex-1 flex flex-col gap-1.5">
            <span className="text-[13px] font-bold text-slate-500">새 블록 (요일·회차)</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="예: 12월 22일(화) 오후"
              className="h-10 rounded-lg px-3 border border-slate-300 outline-none" />
          </label>
          <button className="h-10 px-4 rounded-lg text-sm font-bold text-white disabled:opacity-50" style={{ background: NAVY }} disabled={busy || !label.trim()}
            onClick={async () => { if (await act({ action: 'create_block', label })) setLabel(''); }}>블록 만들기</button>
        </div>

        {data?.blocks.length === 0 && <div className="text-sm text-slate-500">아직 블록이 없어요. 블록을 만든 뒤 참여 코드를 만들어 주세요.</div>}
        {data?.blocks.map((b) => {
          const open = !!b.opened_at && !b.closed_at;
          const studying = b.participants.filter((p) => p.status === '공부 중').length;
          return (
            <div key={b.id} className="bg-white rounded-2xl p-5 flex flex-col gap-4 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="text-lg font-extrabold">{b.label}</div>
                <span className="text-xs font-bold rounded-full px-2.5 py-1" style={open ? { background: '#E7F6EC', color: '#15803D' } : { background: '#EEF1F7', color: '#5B6B8C' }}>
                  {open ? `열림 ${hhmm(b.opened_at)}~` : b.closed_at ? `닫힘 ${hhmm(b.closed_at)}` : '열기 전'}
                </span>
                <span className="text-sm text-slate-500">코드 {b.participants.length}개 · 공부 중 {studying}명</span>
                <div className="flex-1" />
                {open
                  ? <button className={btn} disabled={busy} onClick={() => act({ action: 'close_block', block_id: b.id })}>블록 닫기</button>
                  : <button className="h-9 px-3 rounded-lg text-[13px] font-bold text-white disabled:opacity-50" style={{ background: NAVY }} disabled={busy} onClick={() => act({ action: 'open_block', block_id: b.id })}>블록 열기</button>}
              </div>

              <div className="flex items-center gap-2">
                <input value={counts[b.id] || ''} onChange={(e) => setCounts((c) => ({ ...c, [b.id]: e.target.value.replace(/[^0-9]/g, '').slice(0, 2) }))}
                  placeholder="개수" className="w-20 h-9 rounded-lg px-3 border border-slate-300 outline-none text-sm" />
                <button className={btn} disabled={busy || !counts[b.id]}
                  onClick={async () => {
                    const r = await act({ action: 'gen_codes', block_id: b.id, count: Number(counts[b.id]) });
                    if (r?.made) { setSheet({ block: b.label, rows: r.made }); setCounts((c) => ({ ...c, [b.id]: '' })); }
                  }}>참여 코드 만들기</button>
                <span className="text-xs text-slate-500">PIN은 만든 직후 한 번만 보여 줍니다. 바로 인쇄해 주세요.</span>
              </div>

              {b.participants.length > 0 && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-200">
                      {['코드', '설문', '과목', '계획 저장', '계획(분)', '상태', ''].map((h) => <th key={h} className="py-2 font-bold">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {b.participants.map((p) => (
                      <tr key={p.code} className="border-b border-slate-100">
                        <td className="py-2 font-bold">{p.code}</td>
                        <td>{p.survey_done ? '완료' : '—'}</td>
                        <td>{p.track || '—'}</td>
                        <td>{hhmm(p.plan_at) || '—'}</td>
                        <td>{p.plan_minutes ?? '—'}</td>
                        <td>{p.status}{p.checkout_at ? ` ${hhmm(p.checkout_at)}${SOURCE[p.checkout_source || 'button']}` : ''}</td>
                        <td className="text-right">
                          <span className="inline-flex gap-1.5 items-center">
                            {p.session_id && !p.checkout_at && fixFor?.id === p.session_id && (
                              <>
                                <input type="time" value={fixFor.time} onChange={(e) => setFixFor({ id: p.session_id!, time: e.target.value })}
                                  aria-label={`${p.code} 실제 퇴실 시각`} className="h-9 rounded-lg px-2 border border-slate-300 text-[13px]" />
                                <button className={btn} disabled={busy || !fixFor.time}
                                  onClick={async () => { if (await act({ action: 'fix', session_id: p.session_id, time: fixFor.time })) setFixFor(null); }}>저장</button>
                                <button className={btn} onClick={() => setFixFor(null)}>취소</button>
                              </>
                            )}
                            {p.session_id && !p.checkout_at && fixFor?.id !== p.session_id && censorFor !== p.session_id && (
                              <>
                                <button className={btn} disabled={busy} onClick={() => { setCensorFor(''); setFixFor({ id: p.session_id!, time: '' }); }}>퇴실 보정</button>
                                <button className={btn} disabled={busy} onClick={() => { setFixFor(null); setCensorFor(p.session_id!); }}>종료 처리</button>
                              </>
                            )}
                            {p.session_id && !p.checkout_at && censorFor === p.session_id && (
                              <>
                                <span className="text-[13px] text-slate-600">지금 시각으로 종료할까요?</span>
                                <button className={btn} disabled={busy}
                                  onClick={async () => { if (await act({ action: 'censor', session_id: p.session_id })) setCensorFor(''); }}>종료</button>
                                <button className={btn} onClick={() => setCensorFor('')}>취소</button>
                              </>
                            )}
                            {!p.session_id && (
                              <button className={btn} disabled={busy} onClick={async () => {
                                const r = await act({ action: 'reset_pin', code: p.code });
                                if (r?.made) setSheet({ block: b.label, rows: r.made });
                              }}>PIN 다시 만들기</button>
                            )}
                            {!p.checkout_at && <button className={btn} disabled={busy} onClick={() => enterAs(p.code)} title="리허설용: PIN 없이 이 참여자로 들어갑니다">이 참여자로 들어가기</button>}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}

        <div className="bg-white rounded-2xl p-5 flex flex-col gap-3 shadow-sm">
          <div className="text-lg font-extrabold">설문 문항</div>
          <div className="text-sm text-slate-500">
            등록된 문항 {data?.survey.total}개 (입실 {data?.survey.in}개).{' '}
            {Object.entries(data?.survey.scales || {}).map(([k, n]) => `${k} ${n}`).join(' · ')}
          </div>
          <div className="text-[13px] leading-relaxed text-slate-600">
            표준 척도 문항은 한 줄에 하나씩, 탭으로 구분해 붙여 넣습니다 (엑셀에서 그대로 복사하면 됩니다).<br />
            <b>척도 · 번호 · 유형 · 역채점(0/1) · 퇴실 때도 묻기(0/1) · 왼쪽 끝 말 · 오른쪽 끝 말 · 문항 글</b><br />
            유형: likert5, likert6, likert7, number, date, yesno. 같은 척도·번호를 다시 넣으면 덮어씁니다.
          </div>
          <textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={5}
            className="rounded-lg p-3 border border-slate-300 outline-none text-[13px] font-mono" placeholder={'bscs\t1\tlikert5\t0\t0\t전혀 아니다\t매우 그렇다\t(문항 글)'} />
          <div>
            <button className={btn} disabled={busy || !importText.trim()}
              onClick={async () => { const r = await act({ action: 'import_items', text: importText }); if (r?.ok) { setImportText(''); setMsg(`${r.count}개 문항을 넣었어요`); } }}>문항 넣기</button>
          </div>
        </div>
      </div>

      {/* 코드표: 화면에서는 창으로, 인쇄하면 이것만 나온다 */}
      {sheet && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center print:static print:bg-white">
          <div className="bg-white rounded-2xl p-6 w-[720px] max-h-[90vh] overflow-auto print:w-full print:max-h-none print:rounded-none">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-xl font-extrabold">참여 코드표 — {sheet.block}</div>
                <div className="text-sm text-slate-500">이 창을 닫으면 PIN을 다시 볼 수 없습니다.</div>
              </div>
              <div className="flex gap-2 print:hidden">
                <button className={btn} onClick={() => window.print()}>인쇄</button>
                <button className={btn} onClick={() => setSheet(null)}>닫기</button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {sheet.rows.map((r) => (
                <div key={r.code} className="border border-dashed border-slate-400 rounded-lg p-3 text-center">
                  <div className="text-xs text-slate-500">참여 코드</div>
                  <div className="text-xl font-extrabold">{r.code}</div>
                  <div className="text-xs text-slate-500 mt-1">PIN</div>
                  <div className="text-xl font-extrabold tracking-widest">{r.pin}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
