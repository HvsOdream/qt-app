// 조건별 요소(B 지지형 / C 자극형) 계산. 화면은 여기서 내려준 값만 그린다.
// A(디폴트)는 아무것도 내려주지 않는다.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { LabSession } from '@/lib/lab';

export const LEVELS = ['아직', '시도함', '익숙함', '능숙함', '숙달'] as const;

interface AnswerRow { item_id: string | null; payload: { correct?: boolean } | null; session_id: string | null; id: number }

// 최근 정답률 추세로 4단계(+아직)를 정한다: 최근 6번의 응답만 본다
export function masteryLevel(recent: boolean[]): number {
  const last = recent.slice(-6);
  const n = last.length;
  if (n === 0) return 0;
  const acc = last.filter(Boolean).length / n;
  if (n < 2 || acc < 0.5) return 1;
  if (acc < 0.75) return 2;
  if (acc < 1 || n < 4) return 3;
  return 4;
}

const START_MESSAGE = '틀린 문제를 다시 푸는 건, 약한 곳을 정확히 메우는 공부예요.';

export async function buildOverlay(supabase: SupabaseClient, session: LabSession) {
  if (session.condition === 'A') return { kind: null };

  const now = Date.now();
  const elapsed = Math.max(0, (now - new Date(session.plan_at).getTime()) / 60000);
  const plan = Math.max(1, session.plan_minutes);

  if (session.condition === 'B') {
    // 단원 목록: 오늘 과목의 유사문제가 있는 단원
    const { data: notes } = await supabase
      .from('wrong_note').select('id, subject, topic')
      .eq('device_id', session.user_id).eq('source', 'generated');
    let pool = notes || [];
    const track = (session.track || '').trim();
    const inTrack = pool.filter((n) => (n.subject || '').trim() === track);
    if (track && inTrack.length) pool = inTrack;
    const topicOf = new Map(pool.map((n) => [n.id, (n.topic || '').trim() || '단원 없음']));
    const topics = [...new Set(topicOf.values())];

    const { data: answers } = await supabase
      .from('lab_events').select('id, item_id, payload, session_id')
      .eq('user_id', session.user_id).eq('type', 'item_answered').order('id');
    const rows = (answers || []) as AnswerRow[];
    const byTopic = new Map<string, boolean[]>();
    rows.forEach((r) => {
      const t = r.item_id ? topicOf.get(r.item_id) : undefined;
      if (!t) return;
      if (!byTopic.has(t)) byTopic.set(t, []);
      byTopic.get(t)!.push(!!r.payload?.correct);
    });

    const mastery = topics.map((topic) => {
      const level = masteryLevel(byTopic.get(topic) || []);
      return { topic, level, label: LEVELS[level] };
    });
    const weakest = mastery.length ? [...mastery].sort((a, b) => a.level - b.level)[0] : null;

    // 방금 푼 문제의 단원이 한 단계 올랐는지 (정답 피드백 카드용)
    let last: { topic: string; level: number; label: string; from: number | null } | null = null;
    const mine = rows.filter((r) => r.session_id === session.id);
    const lastRow = mine[mine.length - 1];
    const lastTopic = lastRow?.item_id ? topicOf.get(lastRow.item_id) : undefined;
    if (lastTopic) {
      const all = byTopic.get(lastTopic) || [];
      const after = masteryLevel(all);
      const before = masteryLevel(all.slice(0, -1));
      last = { topic: lastTopic, level: after, label: LEVELS[after], from: before !== after ? before : null };
    }

    const reached = elapsed >= plan;
    return {
      kind: 'support' as const,
      support: {
        goal: { reached, remaining: reached ? 0 : Math.ceil(plan - elapsed), progress: Math.min(1, elapsed / plan) },
        mastery,
        recommend: weakest && weakest.level < 4
          ? {
              topic: weakest.topic,
              hint: weakest.level === 0
                ? '아직 풀어 보지 않은 단원이에요'
                : `${LEVELS[weakest.level]} → ${LEVELS[weakest.level + 1]}까지 정답을 이어 가면 올라가요`,
            }
          : null,
        message: START_MESSAGE,
        last,
      },
    };
  }

  // ─── C 자극형 ───
  const { data: evs } = await supabase
    .from('lab_events').select('id, type, payload')
    .eq('session_id', session.id).in('type', ['item_answered', 'capture']).order('id');
  let xp = 0; let streak = 0; let best = 0;
  let last: { correct: boolean; gain: number; mult: number; streak: number } | null = null;
  (evs || []).forEach((e) => {
    if (e.type === 'capture') { xp += 5; return; }
    const correct = !!(e.payload as { correct?: boolean } | null)?.correct;
    if (correct) {
      streak += 1;
      const mult = streak >= 5 ? 3 : streak >= 3 ? 2 : 1;
      const gain = 10 * mult;
      xp += gain; best = Math.max(best, streak);
      last = { correct, gain, mult, streak };
    } else {
      streak = 0;
      last = { correct, gain: 0, mult: 1, streak: 0 };
    }
  });

  // 목표 달성 보너스: 계획 시간에 닿으면 +50, 그 뒤 10분마다 +10
  const reached = elapsed >= plan;
  const over = Math.max(0, elapsed - plan);
  const bonusEarned = reached ? 50 + Math.floor(over / 10) * 10 : 0;
  const nextIn = reached ? Math.ceil(10 - (over % 10)) : Math.ceil(plan - elapsed);

  // 공부시간 리그: 최근 8시간 안에 입실한 사람들의 체류 시간 순위(익명)
  const since = new Date(now - 8 * 60 * 60 * 1000).toISOString();
  const { data: room } = await supabase
    .from('lab_sessions').select('id, plan_at, checkout_at').gte('plan_at', since).order('plan_at');
  const rows = (room || []).map((r, i) => ({
    id: r.id,
    name: `학습자 ${i + 1}`,
    minutes: Math.floor(((r.checkout_at ? new Date(r.checkout_at).getTime() : now) - new Date(r.plan_at).getTime()) / 60000),
  })).sort((a, b) => b.minutes - a.minutes);
  const myIdx = Math.max(0, rows.findIndex((r) => r.id === session.id));
  const pick = new Set<number>([0, 1, 2, myIdx - 1, myIdx, myIdx + 1].filter((i) => i >= 0 && i < rows.length));
  const top = [...pick].sort((a, b) => a - b).slice(0, 5).map((i) => ({
    rank: i + 1, name: i === myIdx ? '나' : rows[i].name, minutes: rows[i].minutes, me: i === myIdx,
  }));
  const gap = myIdx > 0 ? rows[myIdx - 1].minutes - rows[myIdx].minutes : null;

  return {
    kind: 'stim' as const,
    stim: {
      xp: xp + bonusEarned,
      streak, best,
      bonus: { reached, earned: bonusEarned, nextIn, progress: Math.min(1, elapsed / plan) },
      league: { rank: myIdx + 1, total: rows.length, top, gap },
      last,
    },
  };
}
