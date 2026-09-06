\set ON_ERROR_STOP on
-- Read-only parity at the same immutable cut. This is not a substitute for generated boundary fixtures.
BEGIN;
SET LOCAL statement_timeout='120s';
CREATE TEMP TABLE qa_batch_parity ON COMMIT DROP AS
WITH p AS (SELECT as_of,knowledge_at FROM animal_rule_projection_snapshot WHERE singleton),
animals AS (SELECT DISTINCT ON(s.farm_id) s.animal_id,s.farm_id FROM animal_state_query s ORDER BY s.farm_id,s.animal_id),
contexts AS (SELECT c.* FROM p CROSS JOIN animals a CROSS JOIN LATERAL rule_fact_contexts(p.as_of,p.knowledge_at,false,a.animal_id)c),
asts AS (SELECT a.* FROM p CROSS JOIN LATERAL rule_batch_asts(p.as_of)a)
SELECT c.animal_id,c.farm_id,a.expression_key,a.ast,
evaluate_rule_expression(a.ast,c.context) AS batch_value,
evaluate_rule_expression(a.ast,c.context-'_cached_expression_keys'-'_event_expression_values') AS interpreted_value
FROM contexts c JOIN asts a ON a.farm_id=c.farm_id;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM qa_batch_parity) THEN RAISE EXCEPTION 'No batch expressions tested'; END IF;
 IF EXISTS(SELECT 1 FROM qa_batch_parity WHERE batch_value IS DISTINCT FROM interpreted_value) THEN RAISE EXCEPTION 'Batch/interpreter mismatch'; END IF;
END $$;
SELECT count(*) checked,count(DISTINCT farm_id) farms,
count(*)FILTER(WHERE batch_value IS NULL OR batch_value='null'::jsonb) null_results
FROM qa_batch_parity;
ROLLBACK;
