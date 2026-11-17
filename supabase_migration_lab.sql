-- ============================================================
-- BloomLens Migration: 자율 학습실(실험 테스트베드) 1차
-- 요건 v2(2026-10-27) 기준. Supabase SQL Editor에서 실행
-- ============================================================

-- 참여자: 계정당 한 번 조건을 배정한다. 조건은 서버만 보관한다.
CREATE TABLE IF NOT EXISTS lab_participants (
  user_id     text PRIMARY KEY,
  condition   text NOT NULL CHECK (condition IN ('A', 'B', 'C')),
  created_at  timestamptz DEFAULT now()
);

-- 세션: 계획 저장 시각(plan_at)이 T0, 퇴실 시각이 checkout_at
CREATE TABLE IF NOT EXISTS lab_sessions (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          text NOT NULL,
  condition        text NOT NULL,
  track            text,
  plan_minutes     int  NOT NULL,
  plan_at          timestamptz NOT NULL DEFAULT now(),
  checkout_at      timestamptz,
  checkout_source  text CHECK (checkout_source IN ('button', 'fix', 'censor')),
  reason           text,
  fatigue          int
);

-- 로그: 테이블 하나. 서버 시각(t_server)과 클라이언트 발생 시각(t_ms_client)을 함께 둔다.
CREATE TABLE IF NOT EXISTS lab_events (
  id           bigserial PRIMARY KEY,
  user_id      text NOT NULL,
  session_id   uuid,
  condition    text,
  track        text,
  t_server     timestamptz NOT NULL DEFAULT now(),
  t_ms_client  bigint,
  type         text NOT NULL,
  item_id      text,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_lab_sessions_user ON lab_sessions (user_id, plan_at DESC);
CREATE INDEX IF NOT EXISTS idx_lab_events_session ON lab_events (session_id, id);
CREATE INDEX IF NOT EXISTS idx_lab_events_user ON lab_events (user_id, id);

-- RLS: 정책 없음 → 브라우저 직접 접근 불가. API Route(service_role)만 접근한다.
ALTER TABLE lab_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_sessions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_events       ENABLE ROW LEVEL SECURITY;
