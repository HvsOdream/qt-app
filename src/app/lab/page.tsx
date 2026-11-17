'use client';

// 자율 학습실 — 실험 테스트베드 1차 (조건 A = 디폴트 흐름)
// 오늘 계획(E1) → 홈(E2) → 계속 풀기(E3) → 퇴실(E4)
// 공부 중 화면에는 경과 시간·푼 문항 수·시계를 두지 않는다. 시각은 퇴실 화면에서만 보인다.
import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import type { User } from '@supabase/supabase-js';
import MathText from '@/components/MathText';
import InstallPrompt, { isStandalone } from '@/components/InstallPrompt';

type View = 'loading' | 'login' | 'plan' | 'home' | 'practice' | 'checkout' | 'done';

interface Session {
  id: string;
  track: string | null;
  plan_minutes: number;
  plan_at: string;
  checkout_at: string | null;
}
interface Captured { id: string; question_text: string; topic: string | null; similar: number }
interface Item {
  id: string;
  subject: string | null;
  topic: string | null;
  question_text: string;
  choices: string[];
  question_type: 'multiple_choice' | 'short_answer' | 'essay';
  correct_answer: string;
  explanation: string | null;
  parent_id: string | null;
}
interface SupportOverlay {
  goal: { reached: boolean; remaining: number; progress: number };
  mastery: { topic: string; level: number; label: string }[];
  recommend: { topic: string; hint: string } | null;
  message: string;
  last: { topic: string; level: number; label: string; from: number | null } | null;
}
interface StimOverlay {
  xp: number; streak: number; best: number;
  bonus: { reached: boolean; earned: number; nextIn: number; progress: number };
  league: { rank: number; total: number; top: { rank: number; name: string; minutes: number; me: boolean }[]; gap: number | null };
  last: { correct: boolean; gain: number; mult: number; streak: number } | null;
}
interface Overlay { kind: null | 'support' | 'stim'; support?: SupportOverlay; stim?: StimOverlay }
const LEVEL_NAMES = ['아직', '시도함', '익숙함', '능숙함', '숙달'];
const LEVEL_COLORS = ['#E6EAF2', '#9DB4E3', '#6E91D6', '#3E6BC4', '#FFC94D'];

interface LabEvent { type: string; item_id?: string; payload?: Record<string, unknown>; t_ms_client: number }

const NAVY = '#1B3F8B';
const INK = '#16213A';
const SUB = '#5B6B8C';
const LINE = '#D5DCE8';
const QUEUE_KEY = 'lab_event_queue';

const REASONS: { key: string; label: string }[] = [
  { key: 'plan_done', label: '계획만큼 했어요' },
  { key: 'tired', label: '지쳤어요' },
  { key: 'bored', label: '지루해요' },
  { key: 'other_task', label: '다른 할 일이 있어요' },
  { key: 'etc', label: '기타' },
];

function normalizeAnswer(raw: string | null | undefined): string {
  if (!raw) return '';
  const s = raw.toString().trim();
  const circled: Record<string, string> = { '①': '1', '②': '2', '③': '3', '④': '4', '⑤': '5' };
  if (circled[s]) return circled[s];
  const m = s.match(/(\d+)/);
  return m ? m[1] : s;
}
function normalizeText(s: string): string {
  return s.replace(/\s+/g, '').replace(/＜/g, '<').replace(/＞/g, '>')
    .replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/[=＝]/g, '=').toLowerCase();
}
function isShortAnswerCorrect(student: string, correct: string): boolean {
  if (normalizeText(student) === normalizeText(correct)) return true;
  const sNums = student.match(/-?\d+\.?\d*/g);
  const cNums = correct.match(/-?\d+\.?\d*/g);
  return !!(sNums && cNums && sNums.join(',') === cNums.join(','));
}
const hhmm = (iso: string | Date) =>
  new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });

// ─── 아이콘 ───
const Icon = ({ d, size = 18, color = 'currentColor', width = 2.2 }: { d: string[]; size?: number; color?: string; width?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={width}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d.map((p, i) => <path key={i} d={p} />)}
  </svg>
);
const I = {
  exit: ['M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3', 'M10 17l5-5-5-5M15 12H4'],
  next: ['M9 6l6 6-6 6'],
  back: ['M15 6l-6 6 6 6'],
  play: ['M7 4l12 8-12 8z'],
  camera: ['M4 8a2 2 0 0 1 2-2h2l1.5-2h5L16 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z', 'M12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z'],
  minus: ['M5 12h14'],
  plus: ['M5 12h14M12 5v14'],
  check: ['M5 12l5 5L20 7'],
  x: ['M6 6l12 12M18 6L6 18'],
  flame: ['M12 3c1 3 4 5 4 9a4 4 0 0 1-8 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 0-8z'],
};

const LevelBars = ({ level, w = 22 }: { level: number; w?: number }) => (
  <div className="flex gap-1">
    {[1, 2, 3, 4].map((i) => (
      <span key={i} style={{ width: w, height: w > 20 ? 10 : 8, borderRadius: 3, background: i <= level ? LEVEL_COLORS[level] : '#E6EAF2' }} />
    ))}
  </div>
);

// 자극형 전용 효과음: 짧은 음 몇 개를 이어 낸다
function chime(notes: number[]) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.11;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.22);
    });
    setTimeout(() => { void ctx.close(); }, 900);
  } catch { /* 소리를 낼 수 없는 환경 */ }
}

const Frame = ({ children, bg = '#F4F6FA' }: { children: React.ReactNode; bg?: string }) => (
  <div className="min-h-screen w-full flex justify-center" style={{ background: '#E9EDF5' }}>
    <div className="w-full max-w-[430px] min-h-screen flex flex-col" style={{ background: bg, color: INK }}>
      {children}
    </div>
  </div>
);

export default function LabPage() {
  const [view, setView] = useState<View>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [captured, setCaptured] = useState<Captured[]>([]);
  const [hasPool, setHasPool] = useState(false);
  const [canReset, setCanReset] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [restart, setRestart] = useState(false); // 관리자 테스트용: 퇴실 뒤 새 세션
  const [adminCond, setAdminCond] = useState<'A' | 'B' | 'C'>('A');
  const [overlay, setOverlay] = useState<Overlay>({ kind: null });
  const [feedbackFor, setFeedbackFor] = useState(''); // 요소 값이 이 문항 응답까지 반영됐는지
  const [switchNote, setSwitchNote] = useState(''); // 지지형: 단원이 바뀔 때 한 줄
  const prefer = useRef('');
  const lastTopic = useRef('');
  const prevBonus = useRef<number | null>(null);

  // 계획
  const [minutes, setMinutes] = useState('');
  const [track, setTrack] = useState('');
  const [customTrack, setCustomTrack] = useState('');

  // 계속 풀기
  const [item, setItem] = useState<Item | null>(null);
  const [itemLoading, setItemLoading] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [wasCorrect, setWasCorrect] = useState<boolean | null>(null);
  const [textAnswer, setTextAnswer] = useState('');
  const shownAt = useRef(0);
  const overlayKindRef = useRef<Overlay['kind']>(null);
  const recent = useRef<string[]>([]);
  const answered = useRef(0);

  // 퇴실
  const [reason, setReason] = useState('');
  const [fatigue, setFatigue] = useState(0);
  const [nowText, setNowText] = useState('');

  const tokenRef = useRef('');
  const entered = useRef(false);
  const activeRef = useRef(false); // 입실 중(퇴실 전)일 때만 로그를 쌓는다

  // ─── 서버 호출 ───
  const api = useCallback(async (path: string, init?: RequestInit) => {
    const { data } = await supabase.auth.getSession();
    tokenRef.current = data.session?.access_token || '';
    const res = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenRef.current}`, ...(init?.headers || {}) },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || '요청에 실패했어요');
    return json;
  }, []);

  // ─── 이벤트 큐: 기기에 쌓아 두고 보낸다. 전송에 실패하면 남겨 두었다가 다시 보낸다 ───
  const readQueue = (): LabEvent[] => {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; }
  };
  const writeQueue = (q: LabEvent[]) => {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-2000))); } catch { /* 저장 공간 없음 */ }
  };
  const flushing = useRef(false);
  const flush = useCallback(async () => {
    if (flushing.current) return;
    const q = readQueue();
    if (!q.length) return;
    flushing.current = true;
    try {
      await api('/api/lab/events', { method: 'POST', body: JSON.stringify({ events: q }) });
      const rest = readQueue().slice(q.length);
      writeQueue(rest);
    } catch { /* 다음 주기에 다시 */ }
    finally { flushing.current = false; }
  }, [api]);
  // 대기 중인 로그를 다 보낼 때까지 기다린다 (서버가 방금 응답까지 보고 요소 값을 계산해야 할 때)
  const flushAll = useCallback(async () => {
    for (let i = 0; i < 8 && readQueue().length; i += 1) {
      if (flushing.current) await new Promise((r) => setTimeout(r, 120));
      else await flush();
    }
  }, [flush]);
  const log = useCallback((type: string, payload: Record<string, unknown> = {}, itemId?: string) => {
    if (!activeRef.current) return;
    const q = readQueue();
    q.push({ type, payload, item_id: itemId, t_ms_client: Date.now() });
    writeQueue(q);
    void flush();
  }, [flush]);

  // ─── 조건별 요소 값 (서버가 계산, 화면은 보관하지 않고 매번 받아 온다) ───
  const refreshOverlay = useCallback(async (): Promise<Overlay> => {
    try {
      const o: Overlay = await api('/api/lab/overlay');
      setOverlay(o);
      overlayKindRef.current = o.kind;
      if (o.kind === 'stim' && o.stim) {
        const earned = o.stim.bonus.earned;
        if (prevBonus.current !== null && earned > prevBonus.current) {
          log('element', { kind: 'bonus', value: earned - prevBonus.current, mode: 'earn' });
          chime([660, 880, 1100]);
        }
        prevBonus.current = earned;
      }
      return o;
    } catch { return { kind: null }; }
  }, [api, log]);

  // ─── 상태 불러오기 ───
  const load = useCallback(async () => {
    try {
      const s = await api('/api/lab/state');
      setSession(s.session);
      setSubjects(s.subjects || []);
      setCaptured(s.captured || []);
      setHasPool(!!s.hasPool);
      setCanReset(!!s.canReset);
      setError('');
      activeRef.current = !!s.session && !s.session.checkout_at;
      if (activeRef.current) void refreshOverlay();
      if (activeRef.current && !entered.current) { entered.current = true; log('app_fg', { screen: 'enter', standalone: isStandalone() }); }
      if (!s.session) setView('plan');
      else if (s.session.checkout_at) setView('done');
      else setView((v) => (v === 'practice' || v === 'checkout' ? v : 'home'));
    } catch (e) {
      setError((e as Error).message);
      setView('plan');
    }
  }, [api, log, refreshOverlay]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user ?? null;
      setUser(u);
      if (!u) setView('login'); else void load();
    });
  }, [load]);

  // 앱이 화면에 보이는지: 포그라운드/백그라운드 전환을 남긴다
  useEffect(() => {
    const onVis = () => log(document.visibilityState === 'visible' ? 'app_fg' : 'app_bg');
    document.addEventListener('visibilitychange', onVis);
    const timer = setInterval(() => { void flush(); }, 5000);
    return () => { document.removeEventListener('visibilitychange', onVis); clearInterval(timer); };
  }, [log, flush]);

  // 홈에 있는 동안 요소 값을 1분마다 새로 받는다 (목표 바·보너스·리그가 시간에 따라 바뀐다)
  const atHome = view === 'home';
  const overlayKind = overlay.kind;
  useEffect(() => {
    if (!atHome || !overlayKind) return;
    if (overlayKind === 'support') {
      log('element', { kind: 'goalbar', mode: 'view' });
      log('element', { kind: 'mastery', mode: 'view' });
      log('element', { kind: 'meaning', mode: 'view', where: 'home' });
    } else {
      log('element', { kind: 'streak', mode: 'view' });
      log('element', { kind: 'bonus', mode: 'view' });
      log('element', { kind: 'league', mode: 'view' });
      log('element', { kind: 'xp', mode: 'view' });
    }
    const t = setInterval(() => { void refreshOverlay(); }, 60000);
    return () => clearInterval(t);
  }, [atHome, overlayKind, log, refreshOverlay]);

  // ─── 계획 저장 (입실) ───
  const chosenTrack = track === '__custom' ? customTrack.trim() : track;
  const savePlan = async (restart = false) => {
    const m = Math.round(Number(minutes));
    if (!(m >= 1 && m <= 600)) { setError('공부할 시간을 분으로 적어 주세요.'); return; }
    setBusy(true); setError('');
    try {
      const r = await api('/api/lab/plan', {
        method: 'POST',
        body: JSON.stringify({ minutes: m, track: chosenTrack, restart, condition: restart ? adminCond : undefined, t_ms_client: Date.now() }),
      });
      setSession(r.session);
      activeRef.current = true;
      setRestart(false);
      setCaptured([]);
      prevBonus.current = null;
      void refreshOverlay();
      log('app_fg', { screen: 'enter', standalone: isStandalone() });
      setView('home');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const bump = (d: number) => {
    const cur = Math.round(Number(minutes)) || 0;
    setMinutes(String(Math.min(600, Math.max(10, cur + d))));
  };

  // ─── 계속 풀기 ───
  const loadNext = useCallback(async () => {
    setItemLoading(true); setPicked(null); setWasCorrect(null); setTextAnswer(''); setFeedbackFor('');
    try {
      const r = await api(`/api/lab/next?exclude=${encodeURIComponent(recent.current.slice(-8).join(','))}&prefer=${encodeURIComponent(prefer.current)}`);
      setItem(r.item);
      if (r.item) {
        shownAt.current = Date.now();
        recent.current.push(r.item.id);
        log('item_shown', { parent_id: r.item.parent_id, topic: r.item.topic }, r.item.id);
        const topic = (r.item.topic || '').trim();
        if (overlayKindRef.current === 'support' && topic && lastTopic.current && topic !== lastTopic.current) {
          setSwitchNote(`${topic} 단원으로 넘어왔어요. 아까 틀린 유형을 다른 숫자로 다시 만나 봅니다.`);
          log('element', { kind: 'meaning', mode: 'view', where: 'switch', topic });
        } else {
          setSwitchNote('');
        }
        lastTopic.current = topic;
      }
    } catch (e) { setError((e as Error).message); setItem(null); }
    finally { setItemLoading(false); }
  }, [api, log]);

  const startPractice = (topic = '') => {
    answered.current = 0;
    prefer.current = topic;
    lastTopic.current = '';
    setSwitchNote('');
    log('practice_start');
    setView('practice');
    void loadNext();
  };
  const stopPractice = () => {
    log('practice_stop', { n_answered: answered.current });
    setView('home');
    void load();
  };
  const answer = (value: string, correct: boolean) => {
    if (!item || picked !== null) return;
    setPicked(value); setWasCorrect(correct);
    answered.current += 1;
    log('item_answered', {
      parent_id: item.parent_id, answer: value, correct, rt_ms: Date.now() - shownAt.current,
    }, item.id);
    void fetch('/api/wrong-note/attempt', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attempts: [{ id: item.id, is_correct: correct }] }),
    }).catch(() => {});
    // 조건별 요소: 방금 응답이 서버에 닿은 뒤 값을 다시 받는다 (전 조건이 문항마다 한 번씩 갱신)
    if (overlayKindRef.current) {
      void (async () => {
        await flushAll();
        const o = await refreshOverlay();
        setFeedbackFor(item.id);
        if (o.kind === 'stim' && o.stim?.last) {
          const l = o.stim.last;
          if (l.correct) {
            log('element', { kind: 'xp', value: l.gain, mode: 'earn' });
            if (l.mult > 1) log('element', { kind: 'combo', value: l.mult, mode: 'earn' });
            chime(l.mult > 1 ? [784, 1047, 1319] : [784, 1047]);
          }
          log('element', { kind: 'streak', value: l.streak, mode: 'earn' });
        }
        if (o.kind === 'support' && o.support?.last) {
          log('element', { kind: 'mastery', mode: 'view', where: 'feedback', topic: o.support.last.topic, level: o.support.last.level });
        }
      })();
    }
  };

  // ─── 퇴실 ───
  const openCheckout = () => {
    void refreshOverlay();
    setReason(''); setFatigue(0); setError('');
    setNowText(hhmm(new Date()));
    log('checkout_open');
    setView('checkout');
  };
  const cancelCheckout = () => { log('checkout_cancel'); setView('home'); };
  const confirmCheckout = async () => {
    if (!reason || !fatigue) { setError('이유와 지친 정도를 골라 주세요.'); return; }
    setBusy(true); setError('');
    try {
      await flush();
      const r = await api('/api/lab/checkout', {
        method: 'POST', body: JSON.stringify({ reason, fatigue, t_ms_client: Date.now() }),
      });
      activeRef.current = false;
      setSession(r.session);
      setView('done');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const download = async (kind: 'events' | 'sessions') => {
    const { data } = await supabase.auth.getSession();
    const res = await fetch(`/api/lab/export?kind=${kind}`, {
      headers: { Authorization: `Bearer ${data.session?.access_token || ''}` },
    });
    if (!res.ok) { setError('내보내기에 실패했어요.'); return; }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url; a.download = `lab_${kind}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const ErrorLine = () => error
    ? <div role="alert" className="text-[13px] rounded-xl px-3 py-2" style={{ background: '#FDECEC', color: '#B42318' }}>{error}</div>
    : null;

  const sup = overlay.kind === 'support' ? overlay.support : undefined;
  const stim = overlay.kind === 'stim' ? overlay.stim : undefined;

  // ════════ 화면 ════════
  if (view === 'loading') {
    return <Frame><div className="flex-1 flex items-center justify-center text-sm" style={{ color: SUB }}>불러오는 중…</div></Frame>;
  }

  if (view === 'login') {
    return (
      <Frame>
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center">
          <div className="text-[22px] font-extrabold">자율 학습실</div>
          <div className="text-sm leading-relaxed" style={{ color: SUB }}>먼저 BloomLens에 로그인해 주세요.<br />로그인한 뒤 이 주소로 다시 들어오면 돼요.</div>
          <Link href="/" className="h-14 px-8 rounded-[14px] flex items-center font-bold text-white" style={{ background: NAVY }}>로그인하러 가기</Link>
        </div>
      </Frame>
    );
  }

  // ─── E1 오늘 계획 ───
  if (view === 'plan') {
    return (
      <Frame>
        <InstallPrompt subtitle="학습실이 앱처럼 한 번에 열리고, 화면을 넓게 쓸 수 있어요" />
        <div className="px-5 pt-10 pb-6 flex flex-col gap-3.5 text-white" style={{ background: NAVY }}>
          <div className="flex justify-between items-center">
            <span className="text-lg font-extrabold tracking-tight">BloomLens</span>
            <span className="text-xs font-bold rounded-xl px-2.5 py-1" style={{ background: 'rgba(255,255,255,0.16)' }}>자율 학습실</span>
          </div>
          <div className="text-2xl font-extrabold leading-snug">오늘은 몇 분<br />공부할 생각인가요?</div>
        </div>

        <div className="p-5 flex flex-col gap-4 flex-1">
          <div className="bg-white rounded-[18px] p-5 flex flex-col gap-3.5 shadow-sm">
            <label htmlFor="plan-min" className="text-[13px] font-bold" style={{ color: SUB }}>공부할 시간</label>
            <div className="flex items-center gap-3">
              <button type="button" aria-label="10분 줄이기" onClick={() => bump(-10)}
                className="w-12 h-12 rounded-full bg-white flex items-center justify-center shrink-0" style={{ border: `1.5px solid ${LINE}` }}>
                <Icon d={I.minus} size={20} color={NAVY} width={2.5} />
              </button>
              <div className="flex-1 flex items-baseline justify-center gap-1.5 pb-1.5" style={{ borderBottom: `2px solid ${NAVY}` }}>
                <input id="plan-min" type="number" inputMode="numeric" placeholder="—" value={minutes}
                  onChange={(e) => setMinutes(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
                  className="w-[120px] bg-transparent text-5xl font-extrabold text-center outline-none" style={{ color: INK }} />
                <span className="text-lg font-bold" style={{ color: SUB }}>분</span>
              </div>
              <button type="button" aria-label="10분 늘리기" onClick={() => bump(10)}
                className="w-12 h-12 rounded-full bg-white flex items-center justify-center shrink-0" style={{ border: `1.5px solid ${LINE}` }}>
                <Icon d={I.plus} size={20} color={NAVY} width={2.5} />
              </button>
            </div>
            <div className="text-xs text-center leading-normal" style={{ color: SUB }}>정해진 답은 없어요. 지금 마음먹은 만큼 적어 주세요.</div>
          </div>

          <div className="bg-white rounded-[18px] px-5 py-[18px] flex flex-col gap-3 shadow-sm">
            <div className="text-[13px] font-bold" style={{ color: SUB }}>오늘 공부할 과목</div>
            <div className="flex flex-wrap gap-2">
              {[...subjects, '__custom'].map((s) => {
                const on = track === s;
                return (
                  <button key={s} type="button" onClick={() => setTrack(on ? '' : s)}
                    className="h-10 px-3.5 rounded-full text-sm"
                    style={on
                      ? { border: `2px solid ${NAVY}`, background: '#E8EEFA', color: NAVY, fontWeight: 700 }
                      : { border: `1.5px solid ${LINE}`, background: '#fff', color: '#3C4B6B', fontWeight: 500 }}>
                    {s === '__custom' ? '직접 입력' : s}
                  </button>
                );
              })}
            </div>
            {track === '__custom' && (
              <input value={customTrack} onChange={(e) => setCustomTrack(e.target.value)} placeholder="과목 이름" maxLength={60}
                className="h-11 rounded-xl px-3 text-sm outline-none" style={{ border: `1.5px solid ${LINE}` }} />
            )}
            <div className="text-xs leading-normal" style={{ color: SUB }}>
              교재로 공부하다가 틀린 문제가 나오면 찍어서 비슷한 문제로 연습할 수 있어요. 앱은 쓰고 싶을 때만 쓰면 돼요.
            </div>
          </div>
          <ErrorLine />
        </div>

        <div className="px-5 pb-7 flex flex-col gap-2.5">
          <button type="button" disabled={busy} onClick={() => savePlan(restart)}
            className="h-14 rounded-[14px] text-white flex items-center justify-center gap-2 text-base font-bold disabled:opacity-50" style={{ background: NAVY }}>
            입실하고 시작하기 <Icon d={I.next} color="#fff" width={2.5} />
          </button>
          <div className="text-[11px] text-center" style={{ color: SUB }}>나갈 때 꼭 &lsquo;퇴실&rsquo;을 눌러 주세요</div>
        </div>
      </Frame>
    );
  }

  // ─── E2 홈 (조건 A) ───
  if (view === 'home') {
    return (
      <Frame>
        <div className="px-5 pt-10 pb-5 flex flex-col gap-3.5 text-white" style={{ background: NAVY }}>
          <div className="flex justify-between items-center">
            <span className="text-xs font-bold rounded-xl px-2.5 py-1" style={{ background: 'rgba(255,255,255,0.16)' }}>자율 학습실</span>
            <button type="button" onClick={openCheckout}
              className="h-9 px-3.5 rounded-full bg-white flex items-center gap-1.5 text-[13px] font-bold" style={{ color: NAVY }}>
              <Icon d={I.exit} size={16} color={NAVY} /> 퇴실
            </button>
          </div>
          {!sup && !stim && (
            <div className="flex flex-col gap-0.5">
              {session?.track && <div className="text-[13px] opacity-85">{session.track}</div>}
              <div className="text-[22px] font-extrabold leading-snug">틀린 문제가 생기면<br />찍어서 다시 풀어 봐요</div>
            </div>
          )}

          {/* B 지지형: 숙련도 요약 + 오늘 목표 진척 바 */}
          {sup && (
            <>
              <div className="flex flex-col gap-0.5">
                <div className="text-[13px] opacity-85">{[session?.track, '내 숙련도'].filter(Boolean).join(' · ')}</div>
                <div className="text-[22px] font-extrabold leading-snug">
                  {sup.recommend ? <>지금 가장 약한 단원은<br />{sup.recommend.topic}</> : <>틀린 문제가 생기면<br />찍어서 다시 풀어 봐요</>}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.22)' }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.round(sup.goal.progress * 100)}%`, background: '#FFFFFF' }} />
                </div>
                <div className="text-xs opacity-90">{sup.goal.reached ? '오늘 계획한 시간을 채웠어요' : `목표까지 ${sup.goal.remaining}분`}</div>
              </div>
            </>
          )}

          {/* C 자극형: 연속 정답 스트릭 + 점수 */}
          {stim && (
            <div className="flex items-center gap-3.5">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0" style={{ background: '#FF8A3D' }}>
                <Icon d={I.flame} size={30} color="#fff" width={2} />
              </div>
              <div className="flex-1 flex flex-col gap-1">
                <div className="text-[22px] font-extrabold">{stim.streak > 0 ? `${stim.streak}문제 연속 정답` : '연속 정답에 도전해요'}</div>
                <div className="text-xs opacity-85">
                  {stim.streak > 0 ? '스트릭이 끊기기 전에 이어 가세요' : '맞힐 때마다 스트릭이 쌓여요'} · 최고 기록 {stim.best}
                </div>
              </div>
              <div className="flex flex-col items-end shrink-0">
                <span className="text-[11px] opacity-80">점수</span>
                <span className="text-xl font-extrabold">{stim.xp}</span>
              </div>
            </div>
          )}
        </div>

        <div className="px-5 pt-4 pb-6 flex flex-col gap-3 flex-1">
          {sup && (
            <>
              <div className="rounded-[14px] px-3.5 py-3 text-[13px] leading-relaxed bg-white shadow-sm" style={{ color: '#3C4B6B' }}>{sup.message}</div>
              {sup.recommend && hasPool && (
                <button type="button" onClick={() => startPractice(sup.recommend!.topic)}
                  className="bg-white rounded-[18px] px-[18px] py-4 flex flex-col gap-2.5 text-left" style={{ border: `2px solid ${NAVY}` }}>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold rounded-lg px-2 py-[3px]" style={{ color: NAVY, background: '#E8EEFA' }}>다음 연습 추천</span>
                    <Icon d={I.next} size={16} color={NAVY} width={2} />
                  </div>
                  <div className="text-base font-extrabold">{sup.recommend.topic}</div>
                  <div className="text-xs" style={{ color: SUB }}>{sup.recommend.hint}</div>
                </button>
              )}
              {sup.mastery.length > 0 && (
                <div className="bg-white rounded-2xl px-4 py-1.5 shadow-sm flex flex-col">
                  {sup.mastery.map((m, i) => (
                    <div key={m.topic} className="flex items-center gap-3 py-3" style={i < sup.mastery.length - 1 ? { borderBottom: '1px solid #EEF1F7' } : undefined}>
                      <div className="flex-1 text-sm font-bold truncate">{m.topic}</div>
                      <LevelBars level={m.level} />
                      <span className="w-11 text-[11px] font-bold text-right" style={{ color: m.level >= 2 ? '#3E6BC4' : SUB }}>{m.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {stim && (
            <>
              <div className="rounded-2xl px-4 py-3.5 flex flex-col gap-2.5" style={{ background: '#FFF4EC', border: '1px solid #FFD2B3' }}>
                <div className="flex justify-between items-baseline">
                  <div className="text-sm font-extrabold">목표 보너스</div>
                  <div className="text-[13px] font-extrabold" style={{ color: '#B4440B' }}>{stim.bonus.reached ? `받은 보너스 +${stim.bonus.earned}` : '+50'}</div>
                </div>
                <div className="h-2.5 rounded-full overflow-hidden" style={{ background: '#FFE3CF' }}>
                  <div className="h-full" style={{ width: `${Math.round(stim.bonus.progress * 100)}%`, background: '#FF8A3D' }} />
                </div>
                <div className="text-xs" style={{ color: '#6B3A16' }}>
                  {stim.bonus.reached
                    ? `계획한 시간을 넘겼어요 · ${stim.bonus.nextIn}분 뒤 +10`
                    : `계획한 시간의 ${Math.round(stim.bonus.progress * 100)}% 지점 · 끝까지 가면 보너스`}
                </div>
              </div>
              <div className="bg-white rounded-2xl px-4 py-3.5 shadow-sm flex flex-col gap-2.5">
                <div className="flex justify-between items-center">
                  <div className="text-sm font-extrabold">오늘 공부시간 리그</div>
                  <span className="text-[11px]" style={{ color: SUB }}>이 방 {stim.league.total}명 · 익명</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {stim.league.top.map((r) => (
                    <div key={r.rank} className="flex items-center gap-2.5 text-[13px]"
                      style={r.me ? { background: '#E8EEFA', borderRadius: 10, padding: '8px 10px', margin: '0 -10px', color: NAVY } : undefined}>
                      <span className="w-[18px] font-extrabold" style={{ color: r.me ? NAVY : SUB }}>{r.rank}</span>
                      <span className="flex-1" style={r.me ? { fontWeight: 700 } : undefined}>{r.name}</span>
                      <span className="font-bold">{r.minutes}분</span>
                    </div>
                  ))}
                </div>
                {stim.league.gap !== null && <div className="text-[11px]" style={{ color: SUB }}>{stim.league.rank - 1}위까지 {stim.league.gap}분</div>}
              </div>
            </>
          )}

          {/* 전체 새로 고침으로 넘어간다: 오답노트 화면이 주소의 lab=1 을 처음부터 읽어야 한다 */}
          <button type="button" onClick={async () => { log('capture_open'); await flush(); window.location.href = '/?lab=1'; }}
            className="rounded-[18px] p-[18px] flex items-center gap-3.5 text-white text-left" style={{ background: INK }}>
            <div className="w-[52px] h-[52px] rounded-[14px] flex items-center justify-center shrink-0" style={{ background: 'rgba(255,255,255,0.12)' }}>
              <Icon d={I.camera} size={26} color="#fff" width={2} />
            </div>
            <div className="flex-1 flex flex-col gap-0.5">
              <div className="text-base font-extrabold">틀린 문제 찍기</div>
              <div className="text-xs opacity-75">교재·기출 한 문제만 찍어도 돼요</div>
            </div>
          </button>

          <button type="button" onClick={() => startPractice()} disabled={!hasPool}
            className="bg-white rounded-[18px] px-[18px] py-4 flex items-center gap-3.5 text-left shadow-sm disabled:opacity-60">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: '#E8EEFA' }}>
              <Icon d={I.play} size={22} color={NAVY} width={2} />
            </div>
            <div className="flex-1 flex flex-col gap-0.5">
              <div className="text-[15px] font-extrabold">비슷한 문제 계속 풀기</div>
              <div className="text-xs" style={{ color: SUB }}>
                {!hasPool ? '문제를 찍으면 비슷한 문제가 만들어져요' : stim ? '맞힐 때마다 +10 · 스트릭 이어 가기' : '원할 때까지, 그만두고 싶을 때 멈추면 돼요'}
              </div>
            </div>
            <Icon d={I.next} size={16} color="#9AA6BF" width={2} />
          </button>

          <div className="text-[13px] font-bold mt-1.5" style={{ color: SUB }}>오늘 찍은 문제</div>
          <div className="flex flex-col gap-2">
            {captured.length === 0 && (
              <div className="rounded-[14px] px-3.5 py-3 text-xs bg-white shadow-sm" style={{ color: SUB }}>아직 찍은 문제가 없어요.</div>
            )}
            {captured.map((c) => (
              <div key={c.id} className="bg-white rounded-[14px] px-3.5 py-3 flex items-center gap-3 shadow-sm">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: '#DC2626' }} />
                <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <div className="text-[13px] font-medium truncate">{c.question_text}</div>
                  <div className="text-[11px]" style={{ color: SUB }}>
                    {[c.topic, c.similar ? `비슷한 문제 ${c.similar}개` : '비슷한 문제 없음'].filter(Boolean).join(' · ')}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <ErrorLine />

          <div className="mt-auto rounded-[14px] px-3.5 py-3 text-xs leading-relaxed" style={{ border: `1.5px dashed ${LINE}`, color: SUB }}>
            앱을 안 쓰는 시간도 공부 시간이에요. 교재로 계속 공부하다가 필요할 때 돌아오세요.
          </div>
        </div>
      </Frame>
    );
  }

  // ─── E3 계속 풀기 ───
  if (view === 'practice') {
    const isMultiple = item?.question_type === 'multiple_choice' && (item.choices || []).length > 0;
    const correctNum = normalizeAnswer(item?.correct_answer);
    return (
      <Frame bg="#FFFFFF">
        <div className="px-5 pt-10 flex items-center justify-between gap-3">
          <span className="text-xs rounded-lg px-2.5 py-1 truncate" style={{ color: SUB, background: '#EEF1F7' }}>
            {[item?.subject, item?.topic].filter(Boolean).join(' · ') || '비슷한 문제'}
          </span>
          <button type="button" onClick={stopPractice}
            className="h-9 px-3.5 rounded-full flex items-center gap-1.5 text-[13px] font-bold shrink-0" style={{ border: `1.5px solid ${LINE}`, color: '#3C4B6B' }}>
            <span className="w-2.5 h-2.5 rounded-[2px]" style={{ background: '#3C4B6B' }} /> 그만 풀기
          </button>
        </div>

        <div className="px-5 pt-[22px] flex flex-col gap-4 flex-1">
          {itemLoading && <div className="text-sm" style={{ color: SUB }}>다음 문제를 가져오는 중…</div>}
          {!itemLoading && !item && (
            <div className="text-sm leading-relaxed" style={{ color: SUB }}>풀 문제가 없어요. 틀린 문제를 찍으면 비슷한 문제가 만들어져요.</div>
          )}
          {!itemLoading && item && (
            <>
              {sup && switchNote && (
                <div className="rounded-[14px] px-3.5 py-2.5 text-xs leading-relaxed" style={{ background: '#F4F6FA', color: '#3C4B6B' }}>{switchNote}</div>
              )}
              <div>
                <span className="text-[11px] font-bold rounded-lg px-2 py-[3px]" style={{ color: '#92400E', background: '#FDEBC8' }}>찍은 문제와 비슷한 문제</span>
              </div>
              <div className="text-lg leading-normal font-bold whitespace-pre-wrap"><MathText text={item.question_text} /></div>

              {isMultiple ? (
                <div className="flex flex-col gap-2.5">
                  {item.choices.map((choice, idx) => {
                    const num = String(idx + 1);
                    const isAnswer = num === correctNum;
                    const isPicked = picked === num;
                    let st: React.CSSProperties = { border: '1.5px solid #E6EAF2', background: '#fff', color: INK };
                    let badge: React.CSSProperties = { border: '1.5px solid #E6EAF2', color: SUB };
                    let mark: React.ReactNode = num;
                    if (picked !== null) {
                      if (isAnswer) {
                        st = { border: '2px solid #15803D', background: '#E7F6EC', color: '#15803D', fontWeight: 700 };
                        badge = { background: '#15803D' }; mark = <Icon d={I.check} size={14} color="#fff" width={3} />;
                      } else if (isPicked) {
                        st = { border: '2px solid #DC2626', background: '#FDECEC', color: '#B42318', fontWeight: 700 };
                        badge = { background: '#DC2626' }; mark = <Icon d={I.x} size={12} color="#fff" width={3} />;
                      } else {
                        st = { border: '1.5px solid #E6EAF2', background: '#fff', color: '#9AA6BF' };
                      }
                    }
                    return (
                      <button key={idx} type="button" disabled={picked !== null} onClick={() => answer(num, isAnswer)}
                        className="min-h-[52px] px-4 py-3 rounded-[14px] text-[15px] text-left flex gap-3 items-center" style={st}>
                        <span className="w-[26px] h-[26px] rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={badge}>{mark}</span>
                        <span className="whitespace-pre-wrap"><MathText text={choice.replace(/^\s*(?:[①-⑤]\s*|\d[.)]\s+)/, '')} /></span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  <textarea value={textAnswer} onChange={(e) => setTextAnswer(e.target.value)} disabled={picked !== null}
                    placeholder="정답을 입력하세요" rows={2}
                    className="rounded-[14px] px-4 py-3 text-[15px] outline-none resize-none" style={{ border: `1.5px solid ${LINE}` }} />
                  {picked === null && (
                    <button type="button" disabled={!textAnswer.trim()}
                      onClick={() => answer(textAnswer.trim(), isShortAnswerCorrect(textAnswer.trim(), item.correct_answer))}
                      className="h-12 rounded-[14px] text-white font-bold disabled:opacity-40" style={{ background: NAVY }}>제출</button>
                  )}
                </div>
              )}

              {picked !== null && (
                <div className="rounded-[14px] px-3.5 py-3 flex flex-col gap-1.5"
                  style={wasCorrect ? { background: '#E7F6EC', border: '1px solid #BFE5CB' } : { background: '#FDECEC', border: '1px solid #F5C2C0' }}>
                  <div className="text-sm font-extrabold" style={{ color: wasCorrect ? '#15803D' : '#B42318' }}>
                    {wasCorrect ? '맞았어요' : `틀렸어요 · 정답 ${isMultiple ? correctNum + '번' : item.correct_answer}`}
                  </div>
                  {item.explanation && <div className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: '#3C4B6B' }}><MathText text={item.explanation} /></div>}
                </div>
              )}

              {/* 정답 피드백 카드: 이 한 곳만 조건에 따라 달라진다 */}
              {picked !== null && feedbackFor === item.id && sup?.last && (
                <div className="rounded-[14px] px-3.5 py-3 flex items-center gap-3" style={{ background: '#F4F6FA' }}>
                  <LevelBars level={sup.last.level} w={18} />
                  <div className="text-xs" style={{ color: '#3C4B6B' }}>
                    {sup.last.topic}{' '}
                    <span className="font-extrabold" style={{ color: NAVY }}>
                      {sup.last.from !== null ? `${LEVEL_NAMES[sup.last.from]} → ${sup.last.label}` : sup.last.label}
                    </span>
                    {sup.last.from !== null && sup.last.from < sup.last.level ? ' 올랐어요' : ''}
                  </div>
                </div>
              )}
              {picked !== null && feedbackFor === item.id && stim && (
                <div className="rounded-[14px] px-3.5 py-3 flex items-center gap-3" style={{ background: '#FFF4EC', border: '1px solid #FFD2B3' }}>
                  <span className="text-base font-extrabold animate-bounce-in" style={{ color: '#B4440B' }}>
                    {stim.last?.correct ? `+${stim.last.gain}` : '+0'}
                  </span>
                  <div className="flex-1 text-xs" style={{ color: '#6B3A16' }}>
                    {[
                      stim.last?.correct && stim.last.mult > 1 ? `콤보 ×${stim.last.mult}` : null,
                      stim.streak > 0 ? `${stim.streak}연속` : '스트릭이 끊겼어요',
                      stim.bonus.reached ? `다음 보너스까지 ${stim.bonus.nextIn}분` : `목표 보너스까지 ${stim.bonus.nextIn}분`,
                      `리그 ${stim.league.rank}위`,
                    ].filter(Boolean).join(' · ')}
                  </div>
                </div>
              )}
            </>
          )}
          <ErrorLine />
        </div>

        <div className="px-5 pt-3 pb-7">
          {picked !== null && (
            <button type="button" onClick={() => void loadNext()}
              className="w-full h-[54px] rounded-[14px] text-white flex items-center justify-center gap-2 text-base font-bold" style={{ background: NAVY }}>
              다음 문제 <Icon d={I.next} color="#fff" width={2.5} />
            </button>
          )}
        </div>
      </Frame>
    );
  }

  // ─── E4 퇴실 ───
  if (view === 'checkout') {
    return (
      <Frame>
        <div className="px-5 pt-10 flex items-center gap-3">
          <button type="button" aria-label="돌아가기" onClick={cancelCheckout} className="w-10 h-10 rounded-full bg-white flex items-center justify-center">
            <Icon d={I.back} color={INK} width={2.5} />
          </button>
          <div className="text-[15px] font-bold">퇴실</div>
        </div>

        <div className="p-5 flex flex-col gap-3.5 flex-1">
          <div className="bg-white rounded-[18px] p-5 flex flex-col gap-3 shadow-sm">
            <div className="text-[22px] font-extrabold leading-snug">오늘은 여기까지<br />할까요?</div>
            <div className="grid grid-cols-2 gap-2.5">
              {[['입실', session ? hhmm(session.plan_at) : ''], ['지금', nowText]].map(([k, v]) => (
                <div key={k} className="rounded-xl px-3 py-2.5 flex flex-col gap-0.5" style={{ background: '#F4F6FA' }}>
                  <span className="text-[11px]" style={{ color: SUB }}>{k}</span>
                  <span className="text-[17px] font-extrabold">{v}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-[18px] px-5 py-[18px] flex flex-col gap-3 shadow-sm">
            <div className="text-sm font-extrabold">지금 그만두는 가장 큰 이유는?</div>
            <div className="flex flex-wrap gap-2">
              {REASONS.map((r) => {
                const on = reason === r.key;
                return (
                  <button key={r.key} type="button" onClick={() => setReason(r.key)} className="h-10 px-3.5 rounded-full text-[13px]"
                    style={on
                      ? { border: `2px solid ${NAVY}`, background: '#E8EEFA', color: NAVY, fontWeight: 700 }
                      : { border: `1.5px solid ${LINE}`, background: '#fff', color: '#3C4B6B' }}>
                    {r.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="bg-white rounded-[18px] px-5 py-[18px] flex flex-col gap-3 shadow-sm">
            <div className="text-sm font-extrabold">지금 얼마나 지쳤나요?</div>
            <div className="grid grid-cols-5 gap-2">
              {[1, 2, 3, 4, 5].map((n) => {
                const on = fatigue === n;
                return (
                  <button key={n} type="button" onClick={() => setFatigue(n)} className="h-11 rounded-xl text-[15px]"
                    style={on
                      ? { border: `2px solid ${NAVY}`, background: '#E8EEFA', color: NAVY, fontWeight: 800 }
                      : { border: `1.5px solid ${LINE}`, background: '#fff', color: '#3C4B6B', fontWeight: 700 }}>
                    {n}
                  </button>
                );
              })}
            </div>
            <div className="flex justify-between text-[11px]" style={{ color: SUB }}><span>전혀 안 지침</span><span>매우 지침</span></div>
          </div>

          {stim && (
            <div className="rounded-[18px] px-5 py-4 flex items-center justify-between gap-3" style={{ background: '#FFF4EC', border: '1px solid #FFD2B3' }}>
              <div className="flex flex-col gap-0.5">
                <div className="text-sm font-extrabold">{stim.bonus.reached ? `목표 보너스 +${stim.bonus.earned}` : `목표 보너스까지 ${stim.bonus.nextIn}분`}</div>
                <div className="text-xs" style={{ color: '#6B3A16' }}>{stim.bonus.reached ? `${stim.bonus.nextIn}분 뒤 +10 더` : '지금 나가면 보너스는 없어요'}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[11px]" style={{ color: '#6B3A16' }}>공부시간 리그</div>
                <div className="text-[17px] font-extrabold" style={{ color: '#B4440B' }}>{stim.league.rank}위 / {stim.league.total}명</div>
              </div>
            </div>
          )}
          <ErrorLine />
          <div className="text-xs leading-relaxed px-1" style={{ color: SUB }}>퇴실을 누르면 오늘 기록이 저장돼요. 참여는 오늘 한 번으로 끝나요.</div>
        </div>

        <div className="px-5 pb-7 flex flex-col gap-2.5">
          <button type="button" disabled={busy} onClick={confirmCheckout}
            className="h-14 rounded-[14px] text-white flex items-center justify-center gap-2 text-base font-bold disabled:opacity-50" style={{ background: NAVY }}>
            <Icon d={I.exit} color="#fff" /> 퇴실 기록하기
          </button>
          <button type="button" onClick={cancelCheckout} className="h-11 rounded-[14px] text-[15px] font-bold" style={{ color: NAVY }}>조금 더 할게요</button>
        </div>
      </Frame>
    );
  }

  // ─── 퇴실 뒤 ───
  return (
    <Frame>
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8 text-center">
        <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: '#E7F6EC' }}>
          <Icon d={I.check} size={28} color="#15803D" width={3} />
        </div>
        <div className="text-[22px] font-extrabold">오늘 기록이 저장됐어요</div>
        <div className="text-sm leading-relaxed" style={{ color: SUB }}>참여해 주셔서 고맙습니다.<br />이제 창을 닫아도 돼요.</div>
        <ErrorLine />
        {canReset && (
          <div className="mt-6 w-full rounded-[14px] p-4 flex flex-col gap-2 text-left" style={{ border: `1.5px dashed ${LINE}` }}>
            <div className="text-xs font-bold" style={{ color: SUB }}>관리자 전용 (참여자에게는 보이지 않음)</div>
            <div className="grid grid-cols-3 gap-2">
              {([['A', '기본'], ['B', '지지형'], ['C', '자극형']] as const).map(([c, name]) => (
                <button key={c} type="button" onClick={() => setAdminCond(c)} className="h-9 rounded-xl text-[13px]"
                  style={adminCond === c
                    ? { border: `2px solid ${NAVY}`, background: '#E8EEFA', color: NAVY, fontWeight: 700 }
                    : { border: `1.5px solid ${LINE}`, color: '#3C4B6B' }}>
                  {name}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => { setMinutes(''); setTrack(''); setRestart(true); setView('plan'); }}
              className="h-10 rounded-xl text-sm font-bold" style={{ border: `1.5px solid ${LINE}`, color: NAVY }}>테스트용 새 세션 시작</button>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => download('events')} className="h-10 rounded-xl text-sm font-bold" style={{ border: `1.5px solid ${LINE}`, color: '#3C4B6B' }}>이벤트 CSV</button>
              <button type="button" onClick={() => download('sessions')} className="h-10 rounded-xl text-sm font-bold" style={{ border: `1.5px solid ${LINE}`, color: '#3C4B6B' }}>세션 CSV</button>
            </div>
          </div>
        )}
        {user && <div className="text-[11px] mt-2" style={{ color: '#9AA6BF' }}>참여 코드 {user.id.slice(0, 8)}</div>}
      </div>
    </Frame>
  );
}
