-- A numeric-looking value on a non-literal node must use the interpreter,
-- not the optimized literal-offset path.
DO $$
DECLARE definition text;
BEGIN
  definition := pg_get_functiondef('rule_batch_asts(timestamptz)'::regprocedure);
  IF strpos(definition, 'n.ast->''from''->''right''->>''op''=''LITERAL''') = 0 THEN
    IF strpos(definition, 'n.ast->''from''->''left''->>''key''=''as_of''') = 0 THEN
      RAISE EXCEPTION 'Unexpected batch WINDOW admission definition';
    END IF;
    definition := replace(definition,
      'n.ast->''from''->''left''->>''key''=''as_of''',
      'n.ast->''from''->''left''->>''key''=''as_of'' AND n.ast->''from''->''right''->>''op''=''LITERAL''');
    EXECUTE definition;
  END IF;
END $$;

UPDATE field_definition
SET provenance = jsonb_set(provenance, '{selection}', to_jsonb(
  CASE code WHEN 'AVG_DAILY_MILK_7D' THEN 'farm-local dates [as_of-7, as_of); seven completed dates'
  ELSE 'farm-local dates [as_of-10, as_of); ten completed dates' END))
WHERE farm_id IS NULL AND code IN ('AVG_DAILY_MILK_7D','AVG_DAILY_MILK_10D');

UPDATE animal_rule_projection_snapshot SET stale=true WHERE singleton;
