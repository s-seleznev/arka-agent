-- Assignment-aware OVSYNCH assignment start and step facts. The context is built from effective
-- events only, selects one active assignment per animal, and requires the
-- completed step to belong to that assignment and animal.
WITH definitions(code,name,context_key,provenance) AS (
  VALUES
  ('CURRENT_OVSYNCH_START_DATE','Начало текущего OVSYNCH','current_ovsynch_start_date','{"source":"event_protocol_start.actual_start_at","selection":"active assignment same animal"}'::jsonb),
  ('CURRENT_OVSYNCH_DAY','День текущего OVSYNCH','current_ovsynch_day','{"source":"event_protocol_start.actual_start_at","formula":"local_as_of-start+1"}'::jsonb),
  ('CURRENT_OVSYNCH_BREEDING_ALLOWED','ИО разрешено по текущему статусу','current_ovsynch_breeding_allowed','{"source":"animal status","rule":"status_code != DO_NOT_INSEMINATE; withdrawal is not used as breeding ban"}'::jsonb),
  ('CURRENT_OVSYNCH_GNRH1_DATE','Дата GNRH1 текущего OVSYNCH','current_ovsynch_gnrh1_date','{"source":"event_protocol_step","protocol":"OVSYNCH","step":"GNRH1","selection":"latest active assignment for same animal"}'::jsonb),
  ('CURRENT_OVSYNCH_PGF_DATE','Дата PGF текущего OVSYNCH','current_ovsynch_pgf_date','{"source":"event_protocol_step","protocol":"OVSYNCH","step":"PGF","selection":"latest active assignment for same animal"}'::jsonb),
  ('CURRENT_OVSYNCH_AI_DATE','Дата AI текущего OVSYNCH','current_ovsynch_ai_date','{"source":"event_protocol_step","protocol":"OVSYNCH","step":"AI","selection":"latest active assignment for same animal"}'::jsonb)
)
INSERT INTO field_definition(
  id,code,name,scope,value_type,unit_code,source_kind,is_system,source_ast,
  definition_version,provenance
)
SELECT md5('rule-field:'||code)::uuid,code,name,'ANIMAL','DATE',NULL,
       'CALCULATED',true,jsonb_build_object('op','CONTEXT','key',context_key),1,provenance
FROM definitions
ON CONFLICT DO NOTHING;

INSERT INTO calculated_field(
  id,field_definition_id,version,expression_ast,description,valid_from
)
SELECT md5('rule-formula:'||fd.code)::uuid,fd.id,1,fd.source_ast,
       'Assignment-aware current OVSYNCH start/step fact',fd.valid_from
FROM field_definition fd
WHERE fd.farm_id IS NULL
  AND fd.code IN ('CURRENT_OVSYNCH_START_DATE','CURRENT_OVSYNCH_DAY','CURRENT_OVSYNCH_BREEDING_ALLOWED','CURRENT_OVSYNCH_GNRH1_DATE','CURRENT_OVSYNCH_PGF_DATE','CURRENT_OVSYNCH_AI_DATE')
ON CONFLICT DO NOTHING;

UPDATE field_definition SET value_type='INTEGER',unit_code='DAY'
WHERE code='CURRENT_OVSYNCH_DAY' AND farm_id IS NULL;
UPDATE field_definition SET value_type='BOOLEAN'
WHERE code='CURRENT_OVSYNCH_BREEDING_ALLOWED' AND farm_id IS NULL;

CREATE OR REPLACE FUNCTION rule_fact_contexts(p_as_of timestamptz,p_knowledge timestamptz,p_projection boolean,p_animal_id uuid)
RETURNS TABLE(animal_id uuid,farm_id uuid,context jsonb) LANGUAGE sql STABLE SET enable_nestloop=off AS $$
 WITH base AS MATERIALIZED(
  SELECT * FROM rule_fact_contexts_base(p_as_of,p_knowledge,p_projection,p_animal_id)
 ),
 keys AS MATERIALIZED(
  SELECT farm_id,jsonb_agg(expression_key) AS value FROM rule_batch_asts(p_as_of) GROUP BY farm_id
 ),
 values AS MATERIALIZED(
  SELECT * FROM rule_batch_event_values(p_as_of,p_knowledge,p_animal_id)
 ),
 effective AS MATERIALIZED(
  SELECT * FROM effective_animal_events(p_as_of,p_knowledge)
  WHERE p_animal_id IS NULL OR animal_id=p_animal_id
 ),
 active_assignment AS MATERIALIZED(
  SELECT DISTINCT ON (a.animal_id,a.farm_id)
    a.animal_id,a.farm_id,a.id AS assignment_event_id,pa.protocol_id
  FROM effective a
  JOIN event_protocol_assignment pa ON (pa.event_id,pa.farm_id)=(a.id,a.farm_id)
  JOIN protocol_definition pd ON pd.id=pa.protocol_id AND pd.code='OVSYNCH'
  WHERE NOT EXISTS (
    SELECT 1 FROM effective close
    JOIN event_protocol_completion pc ON (pc.event_id,pc.farm_id)=(close.id,close.farm_id)
    WHERE close.animal_id=a.animal_id AND pc.assignment_event_id=a.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM effective cancel
    JOIN event_protocol_cancellation px ON (px.event_id,px.farm_id)=(cancel.id,cancel.farm_id)
    WHERE cancel.animal_id=a.animal_id AND px.assignment_event_id=a.id
  )
  ORDER BY a.animal_id,a.farm_id,a.occurred_at DESC,a.recorded_at DESC,a.id DESC
 ),
 start_dates AS MATERIALIZED(
  SELECT aa.animal_id,aa.farm_id,(max(ps.actual_start_at AT TIME ZONE f.timezone))::date AS start_date
  FROM active_assignment aa
  JOIN effective se ON se.animal_id=aa.animal_id AND se.farm_id=aa.farm_id AND se.event_code='PROTOCOL_STARTED'
  JOIN event_protocol_start ps ON (ps.event_id,ps.farm_id)=(se.id,se.farm_id) AND ps.assignment_event_id=aa.assignment_event_id
  JOIN farm f ON f.id=aa.farm_id
  WHERE ps.actual_start_at<=p_as_of
  GROUP BY aa.animal_id,aa.farm_id
 ),
 step_dates AS MATERIALIZED(
  SELECT aa.animal_id,aa.farm_id,
   (max(sp.completed_at AT TIME ZONE f.timezone) FILTER(WHERE sd.step_code='GNRH1'))::date AS gnrh1_date,
   (max(sp.completed_at AT TIME ZONE f.timezone) FILTER(WHERE sd.step_code='PGF'))::date AS pgf_date,
   (max(sp.completed_at AT TIME ZONE f.timezone) FILTER(WHERE sd.step_code='AI'))::date AS ai_date
  FROM active_assignment aa
  JOIN effective se ON se.animal_id=aa.animal_id AND se.farm_id=aa.farm_id AND se.event_code='PROTOCOL_STEP_COMPLETED'
  JOIN event_protocol_step sp ON (sp.event_id,sp.farm_id)=(se.id,se.farm_id) AND sp.assignment_event_id=aa.assignment_event_id
  JOIN protocol_step_definition sd ON sd.id=sp.step_definition_id AND sd.protocol_id=aa.protocol_id
  JOIN farm f ON f.id=aa.farm_id
  WHERE sp.completed_at<=p_as_of
  GROUP BY aa.animal_id,aa.farm_id
 )
 SELECT b.animal_id,b.farm_id,
  b.context
  || jsonb_build_object(
    'current_ovsynch_start_date',st.start_date,
    'current_ovsynch_day',CASE WHEN st.start_date IS NULL THEN NULL ELSE ((p_as_of AT TIME ZONE f.timezone)::date-st.start_date+1) END,
    'current_ovsynch_breeding_allowed',CASE WHEN b.context->>'status_code' IS NULL THEN NULL ELSE (b.context->>'status_code' <> 'DO_NOT_INSEMINATE') END,
    'current_ovsynch_gnrh1_date',sd.gnrh1_date,
    'current_ovsynch_pgf_date',sd.pgf_date,
    'current_ovsynch_ai_date',sd.ai_date,
    '_cached_expression_keys',coalesce(k.value,'[]'::jsonb),
    '_event_expression_values',coalesce(v.expression_values,'{}'::jsonb)
  )
 FROM base b
 LEFT JOIN keys k USING(farm_id)
 LEFT JOIN values v USING(animal_id,farm_id)
 LEFT JOIN step_dates sd USING(animal_id,farm_id)
 LEFT JOIN start_dates st USING(animal_id,farm_id)
 JOIN farm f ON f.id=b.farm_id;
$$;

UPDATE animal_rule_projection_snapshot SET stale=true WHERE singleton;

-- No event source currently represents a breeding exclusion; the skill remains explicitly unresolved.
UPDATE animal_rule_projection_snapshot SET stale=true WHERE singleton;

-- Corrective version for non-batch evaluation: keep the seven/ten day
-- windows aligned with the batch interpreter and record the exact bounds.
UPDATE field_definition
SET source_ast=jsonb_set(source_ast,'{to}','{"op":"ADD_DAYS","left":{"op":"CONTEXT","key":"as_of"},"right":{"op":"LITERAL","value":-1}}'::jsonb),
    definition_version=definition_version+1,
    provenance=jsonb_set(provenance,'{selection}',to_jsonb(CASE code WHEN 'AVG_DAILY_MILK_7D' THEN 'farm-local dates [as_of-7, as_of-1], upper bound exclusive' ELSE 'farm-local dates [as_of-10, as_of-1], upper bound exclusive' END))
WHERE code IN ('AVG_DAILY_MILK_7D','AVG_DAILY_MILK_10D') AND farm_id IS NULL;
UPDATE calculated_field cf
SET valid_to=clock_timestamp()
FROM field_definition fd
WHERE fd.id=cf.field_definition_id
  AND fd.code IN ('AVG_DAILY_MILK_7D','AVG_DAILY_MILK_10D')
  AND cf.valid_to IS NULL;
INSERT INTO calculated_field(id,field_definition_id,version,expression_ast,description,valid_from)
SELECT md5('rule-formula:'||fd.code||':v2')::uuid,fd.id,2,fd.source_ast,
       'Process event fact with explicit completed-day window',clock_timestamp()
FROM field_definition fd
WHERE fd.farm_id IS NULL
  AND fd.code IN ('AVG_DAILY_MILK_7D','AVG_DAILY_MILK_10D')
ON CONFLICT DO NOTHING;
UPDATE animal_rule_projection_snapshot SET stale=true WHERE singleton;
