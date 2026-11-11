-- ============================================================
-- BloomLens Migration: 학습 트랙 (교수자용 관리 화면)
-- Supabase SQL Editor에서 실행
-- ============================================================

-- 트랙: 수업·자격증 단위 묶음. 교수자가 만들고 참여 코드로 학생을 연결한다.
CREATE TABLE IF NOT EXISTS tracks (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id    text NOT NULL,                       -- 만든 교수자의 user.id
  name        text NOT NULL,                       -- 학생 오답노트의 "과목"과 같은 값
  kind        text NOT NULL DEFAULT 'class'
              CHECK (kind IN ('class', 'cert', 'personal')),
  join_code   text NOT NULL UNIQUE,                -- 학생이 입력하는 참여 코드
  created_at  timestamptz DEFAULT now()
);

-- 트랙의 단원. 학생 오답노트의 "단원"과 같은 값으로 집계한다.
CREATE TABLE IF NOT EXISTS track_units (
  id        uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  track_id  uuid NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  order_no  int  NOT NULL DEFAULT 0,
  title     text NOT NULL
);

-- 트랙 참여 학생
CREATE TABLE IF NOT EXISTS track_members (
  track_id   uuid NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  user_id    text NOT NULL,                        -- 학생의 user.id
  joined_at  timestamptz DEFAULT now(),
  PRIMARY KEY (track_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_tracks_owner        ON tracks (owner_id);
CREATE INDEX IF NOT EXISTS idx_track_units_track   ON track_units (track_id, order_no);
CREATE INDEX IF NOT EXISTS idx_track_members_user  ON track_members (user_id);

-- RLS: 정책을 두지 않는다 → 브라우저에서 직접 접근 불가.
-- 모든 접근은 API Route(service_role)에서 로그인 사용자를 확인한 뒤 이루어진다.
ALTER TABLE tracks        ENABLE ROW LEVEL SECURITY;
ALTER TABLE track_units   ENABLE ROW LEVEL SECURITY;
ALTER TABLE track_members ENABLE ROW LEVEL SECURITY;
