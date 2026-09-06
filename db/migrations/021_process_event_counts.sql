-- Counts needed by the accepted current-lactation process predicates.
-- EVENT_COUNT is an existing interpreter operation; no new formula semantics.
WITH definitions(code,name,source_ast,provenance) AS (
  VALUES
  ('INSEMINATION_COUNT_CURRENT_LACTATION','ИО текущей лактации',
   '{"op":"EVENT_COUNT","event":"INSEMINATED","scope":"CURRENT_LACTATION"}'::jsonb,
   '{"source":"event_insemination","selection":"effective events since latest CALVED"}'::jsonb),
  ('MILK_TEST_COUNT_CURRENT_LACTATION','Количество КД текущей лактации',
   '{"op":"EVENT_COUNT","event":"MILK_TESTED","scope":"CURRENT_LACTATION"}'::jsonb,
   '{"source":"event_milk_test","selection":"effective tests since latest CALVED"}'::jsonb)
)
INSERT INTO field_definition(
  id,code,name,scope,value_type,unit_code,source_kind,is_system,source_ast,
  definition_version,provenance
)
SELECT md5('rule-field:'||code)::uuid,code,name,'ANIMAL','INTEGER',NULL,
       'CALCULATED',true,source_ast,1,provenance
FROM definitions
ON CONFLICT DO NOTHING;

INSERT INTO calculated_field(
  id,field_definition_id,version,expression_ast,description,valid_from
)
SELECT md5('rule-formula:'||fd.code)::uuid,fd.id,1,fd.source_ast,
       'Process event count backed by the typed event source',fd.valid_from
FROM field_definition fd
WHERE fd.farm_id IS NULL
  AND fd.code IN ('INSEMINATION_COUNT_CURRENT_LACTATION','MILK_TEST_COUNT_CURRENT_LACTATION')
ON CONFLICT DO NOTHING;

UPDATE animal_rule_projection_snapshot SET stale=true WHERE singleton;
