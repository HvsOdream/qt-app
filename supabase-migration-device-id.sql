-- ============================================================
-- QT 앱 device_id 마이그레이션
-- Supabase SQL Editor에서 실행하세요
-- ============================================================

-- 1. question_bank 테이블에 device_id 컬럼 추가
ALTER TABLE question_bank
  ADD COLUMN IF NOT EXISTS device_id TEXT DEFAULT 'unknown';

-- 2. quiz_results 테이블에 device_id 컬럼 추가
ALTER TABLE quiz_results
  ADD COLUMN IF NOT EXISTS device_id TEXT DEFAULT 'unknown';

-- 3. 인덱스 생성 (필터링 성능 향상)
CREATE INDEX IF NOT EXISTS idx_question_bank_device_id
  ON question_bank(device_id);

CREATE INDEX IF NOT EXISTS idx_quiz_results_device_id
  ON quiz_results(device_id);

-- ============================================================
-- 실행 후 확인 쿼리
-- ============================================================
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name IN ('question_bank', 'quiz_results')
--   AND column_name = 'device_id';
