-- ============================================================
-- BloomLens v2.1 Migration: user_note 컬럼 추가
-- 사용자가 직접 적는 해설/메모 (AI explanation과 별개)
-- Supabase SQL Editor에서 실행
-- ============================================================

ALTER TABLE wrong_note
  ADD COLUMN IF NOT EXISTS user_note text DEFAULT NULL;

-- 완료 확인
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'wrong_note' AND column_name = 'user_note';
