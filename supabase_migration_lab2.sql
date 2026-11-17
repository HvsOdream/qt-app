-- ============================================================
-- BloomLens Migration: 자율 학습실 3차 — 블록, 익명 코드, 설문
-- Supabase SQL Editor에서 실행 (supabase_migration_lab.sql 다음)
-- ============================================================

-- 세션 블록(요일/회차): 조교가 열고 닫는다
CREATE TABLE IF NOT EXISTS lab_blocks (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  label       text NOT NULL,
  opened_at   timestamptz,
  closed_at   timestamptz,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE lab_participants ADD COLUMN IF NOT EXISTS block_id uuid REFERENCES lab_blocks(id);
ALTER TABLE lab_participants ADD COLUMN IF NOT EXISTS research_code text UNIQUE;
ALTER TABLE lab_participants ADD COLUMN IF NOT EXISTS survey_done_at timestamptz;

ALTER TABLE lab_sessions ADD COLUMN IF NOT EXISTS block_id uuid;
ALTER TABLE lab_sessions ADD COLUMN IF NOT EXISTS survey_out jsonb;

-- 설문 문항: 글은 여기서 내려준다 (고치기 쉽게)
-- phase: in = 입실 설문, out = 퇴실 때만, mc = 퇴실 뒤 조작점검
-- also_out: 입실 문항을 퇴실 때 같은 순서로 다시 묻는다 (SSCCS)
CREATE TABLE IF NOT EXISTS lab_survey_items (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  scale          text NOT NULL,
  item_no        int  NOT NULL,
  text_ko        text NOT NULL,
  response_type  text NOT NULL CHECK (response_type IN ('likert5', 'likert6', 'likert7', 'number', 'date', 'yesno')),
  reverse        boolean NOT NULL DEFAULT false,
  phase          text NOT NULL DEFAULT 'in' CHECK (phase IN ('in', 'out', 'mc')),
  also_out       boolean NOT NULL DEFAULT false,
  min_label      text,
  max_label      text,
  unit           text,
  sort           int NOT NULL DEFAULT 0,
  UNIQUE (scale, item_no)
);

ALTER TABLE lab_blocks       ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_survey_items ENABLE ROW LEVEL SECURITY;

-- 자체 문항(설계서 v0.4 부록 A·B의 비표준 문항). 표준 척도(BSCS·암묵이론·SSCCS·SRQ·BFI-10)는
-- 공인 한국어판 문항을 조교 화면에서 붙여 넣어 채운다.
INSERT INTO lab_survey_items (scale, item_no, text_ko, response_type, phase, min_label, max_label, unit, sort) VALUES
  ('prior_effort', 1, '오늘 여기 오기 전에 수업·공부처럼 머리를 쓰는 일을 몇 시간 했나요?', 'number', 'in', NULL, NULL, '시간', 610),
  ('sleep',        1, '어젯밤에 몇 시간 잤나요?', 'number', 'in', NULL, NULL, '시간', 620),
  ('opp_cost',     1, '지금 공부 대신 하고 싶은 일이 있다.', 'likert5', 'in', '전혀 아니다', '매우 그렇다', NULL, 630),
  ('opp_cost',     2, '그 일이 지금 얼마나 끌리나요?', 'likert5', 'in', '전혀 끌리지 않는다', '매우 끌린다', NULL, 640),
  ('habit',        1, '일주일에 게임을 몇 시간쯤 하나요?', 'number', 'in', NULL, NULL, '시간', 810),
  ('habit',        2, '모바일 학습 앱(영어·자격증 앱 등)을 써 본 적이 있나요?', 'yesno', 'in', NULL, NULL, NULL, 820),
  ('habit',        3, '연속 출석(스트릭)이나 순위표(리그)가 있는 앱을 써 본 적이 있나요?', 'yesno', 'in', NULL, NULL, NULL, 830),
  ('exam_date',    1, '준비하는 자격증 시험은 언제인가요?', 'date', 'in', NULL, NULL, NULL, 910),
  ('mc',           1, '오늘 공부하는 동안 목표까지 얼마나 남았는지 알 수 있었다.', 'likert5', 'mc', '전혀 아니다', '매우 그렇다', NULL, 10),
  ('mc',           2, '오늘 공부하는 동안 보상(점수·보너스)을 받았다.', 'likert5', 'mc', '전혀 아니다', '매우 그렇다', NULL, 20),
  ('mc',           3, '오늘 공부하는 동안 다른 사람과 비교되는 느낌이 있었다.', 'likert5', 'mc', '전혀 아니다', '매우 그렇다', NULL, 30)
ON CONFLICT (scale, item_no) DO NOTHING;
