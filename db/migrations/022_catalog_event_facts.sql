-- Catalog-bound event dates. Filters use stable system catalog UUIDs and the
-- existing EVENT_DATE operator; cancellation/current-assignment semantics are
-- intentionally not inferred by these fact fields.
WITH definitions(code,name,event_code,where_clause,provenance) AS (
  VALUES
  ('LAST_KETOSIS_DIAGNOSIS_DATE','Дата последнего диагноза кетоза','DIAGNOSED','{"disease_id":"08faba73-2c86-66de-8c4d-136218a3eab7"}'::jsonb,'{"source":"event_diagnosis","disease":"KETOSIS"}'::jsonb),
  ('LAST_LAMENESS_DIAGNOSIS_DATE','Дата последнего диагноза хромоты','DIAGNOSED','{"disease_id":"6f65765d-bf80-3698-9884-08d5b0a1002a"}'::jsonb,'{"source":"event_diagnosis","disease":"LAMENESS"}'::jsonb),
  ('LAST_MASTITIS_DIAGNOSIS_DATE','Дата последнего диагноза мастита','DIAGNOSED','{"disease_id":"ae33a1c4-8faa-69db-c441-100723b96798"}'::jsonb,'{"source":"event_diagnosis","disease":"MASTITIS"}'::jsonb),
  ('LAST_METRITIS_DIAGNOSIS_DATE','Дата последнего диагноза метрита','DIAGNOSED','{"disease_id":"bbc3e6d4-a866-8069-a53d-816487e11772"}'::jsonb,'{"source":"event_diagnosis","disease":"METRITIS"}'::jsonb),
  ('LAST_RESPIRATORY_DIAGNOSIS_DATE','Дата последнего респираторного диагноза','DIAGNOSED','{"disease_id":"0476c593-5df1-3965-ffca-e95b66666ff2"}'::jsonb,'{"source":"event_diagnosis","disease":"RESPIRATORY_DISEASE"}'::jsonb),
  ('LAST_BASE_VACCINATION_DATE','Дата последней BASE вакцинации','VACCINATED','{"product_id":"694105bf-8a0d-d54e-daf0-2da39a9d69e0"}'::jsonb,'{"source":"event_vaccination","product":"BASE_VACCINE"}'::jsonb),
  ('LAST_OVSYNCH_GNRH1_STEP_DATE','Дата шага OVSYNCH GNRH1','PROTOCOL_STEP_COMPLETED','{"step_definition_id":"4800660d-828b-f8aa-eefe-caa0c8399332"}'::jsonb,'{"source":"event_protocol_step","protocol":"OVSYNCH","step":"GNRH1"}'::jsonb),
  ('LAST_OVSYNCH_PGF_STEP_DATE','Дата шага OVSYNCH PGF','PROTOCOL_STEP_COMPLETED','{"step_definition_id":"23491ad6-4429-9264-d9c4-4319f8c3f87e"}'::jsonb,'{"source":"event_protocol_step","protocol":"OVSYNCH","step":"PGF"}'::jsonb),
  ('LAST_OVSYNCH_AI_STEP_DATE','Дата шага OVSYNCH AI','PROTOCOL_STEP_COMPLETED','{"step_definition_id":"bb6ce1de-5e0f-4316-59e8-1f065eabb771"}'::jsonb,'{"source":"event_protocol_step","protocol":"OVSYNCH","step":"AI"}'::jsonb)
), asts AS (
  SELECT code,name,provenance,
         jsonb_build_object('op','EVENT_DATE','event',event_code,'order','DESC','position',1,'scope','LIFETIME','where',where_clause) AS source_ast
  FROM definitions
)
INSERT INTO field_definition(
  id,code,name,scope,value_type,unit_code,source_kind,is_system,source_ast,
  definition_version,provenance
)
SELECT md5('rule-field:'||code)::uuid,code,name,'ANIMAL','DATE',NULL,
       'CALCULATED',true,source_ast,1,provenance
FROM asts
ON CONFLICT DO NOTHING;

INSERT INTO calculated_field(
  id,field_definition_id,version,expression_ast,description,valid_from
)
SELECT md5('rule-formula:'||fd.code)::uuid,fd.id,1,fd.source_ast,
       'Catalog-bound process event date',fd.valid_from
FROM field_definition fd
WHERE fd.farm_id IS NULL
  AND fd.code IN (
    'LAST_KETOSIS_DIAGNOSIS_DATE','LAST_LAMENESS_DIAGNOSIS_DATE',
    'LAST_MASTITIS_DIAGNOSIS_DATE','LAST_METRITIS_DIAGNOSIS_DATE',
    'LAST_RESPIRATORY_DIAGNOSIS_DATE','LAST_BASE_VACCINATION_DATE',
    'LAST_OVSYNCH_GNRH1_STEP_DATE','LAST_OVSYNCH_PGF_STEP_DATE',
    'LAST_OVSYNCH_AI_STEP_DATE'
  )
ON CONFLICT DO NOTHING;

UPDATE animal_rule_projection_snapshot SET stale=true WHERE singleton;
