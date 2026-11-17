-- mirrai: idempotent-migration
--
-- Held-out eval cases remember which stretch of the record they came
-- from, so a later run can still group the scores by period.

ALTER TABLE "eval_cases"
  ADD COLUMN IF NOT EXISTS "periodId" varchar(32);

-- mirrai: down
ALTER TABLE "eval_cases" DROP COLUMN IF EXISTS "periodId";
