-- Process facts backed only by the existing generic event expression interpreter.
-- No source CSV semantics are introduced here; every field keeps effective
-- event ordering, as_of/knowledge cuts, and farm-local date conversion.
WITH definitions(code,name,value_type,unit_code,source_ast,provenance) AS (
  VALUES
  ('AVG_DAILY_MILK_7D','Среднесуточный надой за 7 дней','NUMERIC','KG',
   '{"op":"EVENT_AGGREGATE","event":"DAILY_MILK_RECORDED","value":"milk_kg","aggregate":"AVG","scope":"WINDOW","from":{"op":"ADD_DAYS","left":{"op":"CONTEXT","key":"as_of"},"right":{"op":"LITERAL","value":-7}},"to":{"op":"CONTEXT","key":"as_of"}}'::jsonb,
   '{"source":"event_daily_milk.milk_kg","window_days":7,"selection":"farm-local dates [as_of-7, as_of)"}'::jsonb),
  ('AVG_DAILY_MILK_10D','Среднесуточный надой за 10 дней','NUMERIC','KG',
   '{"op":"EVENT_AGGREGATE","event":"DAILY_MILK_RECORDED","value":"milk_kg","aggregate":"AVG","scope":"WINDOW","from":{"op":"ADD_DAYS","left":{"op":"CONTEXT","key":"as_of"},"right":{"op":"LITERAL","value":-10}},"to":{"op":"CONTEXT","key":"as_of"}}'::jsonb,
   '{"source":"event_daily_milk.milk_kg","window_days":10,"selection":"farm-local dates [as_of-10, as_of)"}'::jsonb),
  ('LAST_DAILY_MILK_DATE','Дата последнего суточного надоя','DATE',NULL,
   '{"op":"EVENT_VALUE","event":"DAILY_MILK_RECORDED","value":"farm_date","order":"DESC","position":1,"scope":"LIFETIME"}'::jsonb,
   '{"source":"event_daily_milk.farm_date","selection":"latest effective event detail date"}'::jsonb),
  ('LAST_MILK_TEST_UREA','Мочевина последнего КД','NUMERIC',NULL,
   '{"op":"EVENT_VALUE","event":"MILK_TESTED","value":"urea","order":"DESC","position":1,"scope":"CURRENT_LACTATION"}'::jsonb,
   '{"source":"event_milk_test.urea","selection":"latest effective test in current lactation"}'::jsonb),
  ('PREVIOUS_MILK_TEST_UREA','Мочевина предпоследнего КД','NUMERIC',NULL,
   '{"op":"EVENT_VALUE","event":"MILK_TESTED","value":"urea","order":"DESC","position":2,"scope":"CURRENT_LACTATION"}'::jsonb,
   '{"source":"event_milk_test.urea","selection":"second latest effective test in current lactation"}'::jsonb),
  ('LAST_MILK_TEST_SOMATIC_CELLS','Соматика последнего КД','INTEGER',NULL,
   '{"op":"EVENT_VALUE","event":"MILK_TESTED","value":"somatic_cells","order":"DESC","position":1,"scope":"CURRENT_LACTATION"}'::jsonb,
   '{"source":"event_milk_test.somatic_cells","selection":"latest effective test in current lactation"}'::jsonb),
  ('PREVIOUS_MILK_TEST_SOMATIC_CELLS','Соматика предпоследнего КД','INTEGER',NULL,
   '{"op":"EVENT_VALUE","event":"MILK_TESTED","value":"somatic_cells","order":"DESC","position":2,"scope":"CURRENT_LACTATION"}'::jsonb,
   '{"source":"event_milk_test.somatic_cells","selection":"second latest effective test in current lactation"}'::jsonb),
  ('LAST_VACCINATION_DATE','Дата последней вакцинации','DATE',NULL,
   '{"op":"EVENT_DATE","event":"VACCINATED","order":"DESC","position":1,"scope":"LIFETIME"}'::jsonb,
   '{"source":"event_vaccination","selection":"latest effective vaccination event; product stage not inferred"}'::jsonb),
  ('LAST_DIAGNOSIS_DATE','Дата последнего диагноза','DATE',NULL,
   '{"op":"EVENT_DATE","event":"DIAGNOSED","order":"DESC","position":1,"scope":"LIFETIME"}'::jsonb,
   '{"source":"event_diagnosis","selection":"latest effective diagnosis event; disease not inferred"}'::jsonb),
  ('LAST_HOOF_PROCEDURE_DATE','Дата последней расчистки копыт','DATE',NULL,
   '{"op":"EVENT_DATE","event":"HOOF_PROCEDURE","order":"DESC","position":1,"scope":"LIFETIME"}'::jsonb,
   '{"source":"event_hoof_procedure","selection":"latest effective hoof procedure event"}'::jsonb),
  ('LAST_PROTOCOL_STEP_DATE','Дата последнего шага протокола','DATE',NULL,
   '{"op":"EVENT_DATE","event":"PROTOCOL_STEP_COMPLETED","order":"DESC","position":1,"scope":"LIFETIME"}'::jsonb,
   '{"source":"event_protocol_step","selection":"latest effective completed step; assignment and step identity remain event details"}'::jsonb)
)
INSERT INTO field_definition(
  id,code,name,scope,value_type,unit_code,source_kind,is_system,source_ast,
  definition_version,provenance
)
SELECT md5('rule-field:'||code)::uuid,code,name,'ANIMAL',value_type,unit_code,
       'CALCULATED',true,source_ast,1,provenance
FROM definitions
ON CONFLICT DO NOTHING;

INSERT INTO calculated_field(
  id,field_definition_id,version,expression_ast,description,valid_from
)
SELECT md5('rule-formula:'||c.code)::uuid,fd.id,1,fd.source_ast,
       'Process event fact backed by the typed event source',fd.valid_from
FROM (
  SELECT * FROM (VALUES
    ('AVG_DAILY_MILK_7D'),('AVG_DAILY_MILK_10D'),('LAST_DAILY_MILK_DATE'),
    ('LAST_MILK_TEST_UREA'),('PREVIOUS_MILK_TEST_UREA'),
    ('LAST_MILK_TEST_SOMATIC_CELLS'),('PREVIOUS_MILK_TEST_SOMATIC_CELLS'),
    ('LAST_VACCINATION_DATE'),('LAST_DIAGNOSIS_DATE'),
    ('LAST_HOOF_PROCEDURE_DATE'),('LAST_PROTOCOL_STEP_DATE')
  ) AS codes(code)
) c
JOIN field_definition fd ON fd.code=c.code AND fd.farm_id IS NULL
JOIN LATERAL (SELECT fd.source_ast) d ON true
ON CONFLICT DO NOTHING;

UPDATE animal_rule_projection_snapshot SET stale=true WHERE singleton;
