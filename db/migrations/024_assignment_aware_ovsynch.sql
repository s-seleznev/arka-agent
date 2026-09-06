-- Assignment-aware OVSYNCH step facts. The context is built from effective
-- events only, selects one active assignment per animal, and requires the
-- completed step to belong to that assignment and animal.
WITH definitions(code,name,context_key,provenance) AS (
  VALUES
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
       'Assignment-aware current OVSYNCH step date',fd.valid_from
FROM field_definition fd
WHERE fd.farm_id IS NULL
  AND fd.code IN ('CURRENT_OVSYNCH_GNRH1_DATE','CURRENT_OVSYNCH_PGF_DATE','CURRENT_OVSYNCH_AI_DATE')
ON CONFLICT DO NOTHING;

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
    'current_ovsynch_gnrh1_date',sd.gnrh1_date,
    'current_ovsynch_pgf_date',sd.pgf_date,
    'current_ovsynch_ai_date',sd.ai_date,
    '_cached_expression_keys',coalesce(k.value,'[]'::jsonb),
    '_event_expression_values',coalesce(v.expression_values,'{}'::jsonb)
  )
 FROM base b
 LEFT JOIN keys k USING(farm_id)
 LEFT JOIN values v USING(animal_id,farm_id)
 LEFT JOIN step_dates sd USING(animal_id,farm_id);
$$;

UPDATE animal_rule_projection_snapshot SET stale=true WHERE singleton;
