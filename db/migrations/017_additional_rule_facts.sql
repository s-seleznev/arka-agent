-- Three existing fact sources, expressed solely through the generic event AST.
INSERT INTO field_definition(id,code,name,scope,value_type,unit_code,source_kind,is_system,source_ast,definition_version,provenance)
VALUES
(md5('rule-field:BIRTH_WEIGHT_KG')::uuid,'BIRTH_WEIGHT_KG','Вес при рождении','ANIMAL','NUMERIC','KG','CALCULATED',true,'{"op":"EVENT_VALUE","event":"BORN","value":"birth_weight_kg","order":"DESC","position":1,"scope":"LIFETIME"}',1,'{"source":"event_birth.birth_weight_kg","selection":"latest effective birth event; never latest non-null","sourceCsvExample":"1/1789"}'),
(md5('rule-field:EXIT_DATE')::uuid,'EXIT_DATE','Дата выбытия','ANIMAL','DATE',NULL,'CALCULATED',true,'{"op":"EVENT_DATE","event":"EXITED","order":"DESC","position":1,"scope":"LIFETIME"}',1,'{"source":"animal_event.occurred_at + event_exit","selection":"latest effective exit, farm-local calendar date","sourceCsvExample":"1/1826"}'),
(md5('rule-field:LAST_MILK_TEST_KG')::uuid,'LAST_MILK_TEST_KG','Надой посл. КД','ANIMAL','NUMERIC','KG','CALCULATED',true,'{"op":"EVENT_VALUE","event":"MILK_TESTED","value":"milk_kg","order":"DESC","position":1,"scope":"LIFETIME"}',1,'{"source":"event_milk_test.milk_kg","selection":"latest effective milk test, including null result; independent of daily milk","sourceCsvExample":"1/1950"}');

-- Bulk cache is driven by event names found in effective registered ASTs.
-- The allowlist resolves table names; no source CSV SQL or arbitrary table is executed.
CREATE FUNCTION rule_bulk_event_contexts(p_as_of timestamptz,p_knowledge timestamptz,p_animal_id uuid DEFAULT NULL)
RETURNS TABLE(animal_id uuid,farm_id uuid,event_code text,records jsonb)
LANGUAGE plpgsql STABLE AS $$
DECLARE source record;
BEGIN
 FOR source IN
  SELECT DISTINCT es.event_code,es.detail_table FROM farm f
  CROSS JOIN LATERAL jsonb_path_query(rule_field_registry(f.id,p_as_of),'$.**.event') item
  JOIN rule_event_source es ON es.event_code=(item#>>'{}')
 LOOP
  RETURN QUERY EXECUTE format(
   'SELECT e.animal_id,e.farm_id,$4::text,jsonb_agg(jsonb_build_object(''id'',e.id,''occurred_at'',e.occurred_at,''recorded_at'',e.recorded_at,''details'',to_jsonb(d)))
    FROM effective_animal_events($1,$2)e JOIN %s d ON (d.event_id,d.farm_id)=(e.id,e.farm_id)
    WHERE e.event_code=$4 AND ($3::uuid IS NULL OR e.animal_id=$3) GROUP BY e.animal_id,e.farm_id',source.detail_table)
  USING p_as_of,p_knowledge,p_animal_id,source.event_code;
 END LOOP;
END $$;
CREATE FUNCTION rule_event_records(p_animal uuid,p_event text,p_as_of timestamptz,p_knowledge timestamptz,p_context jsonb)
RETURNS TABLE(id uuid,occurred_at timestamptz,recorded_at timestamptz,details jsonb)
LANGUAGE plpgsql STABLE AS $$
BEGIN
 IF p_context ? '_cached_event_codes' AND (p_context->'_cached_event_codes') ? p_event THEN
  RETURN QUERY SELECT * FROM jsonb_to_recordset(coalesce(p_context->'_event_records'->p_event,'[]'::jsonb))
   AS r(id uuid,occurred_at timestamptz,recorded_at timestamptz,details jsonb);
 ELSE
  RETURN QUERY SELECT * FROM rule_event_records(p_animal,p_event,p_as_of,p_knowledge);
 END IF;
END $$;
-- Preserve the audited generic operator implementation; substitute only its data provider.
DO $$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('evaluate_rule_expression_events(jsonb,jsonb,text[])'::regprocedure);
 IF strpos(definition,'rule_event_records(animal,v_event_code,asof,knowledge)')=0 THEN RAISE EXCEPTION 'unexpected event interpreter definition'; END IF;
 definition:=replace(definition,'rule_event_records(animal,v_event_code,asof,knowledge)','rule_event_records(animal,v_event_code,asof,knowledge,p_context)');
 definition:=replace(definition,'rule_event_records(animal,''CALVED'',asof,knowledge)','rule_event_records(animal,''CALVED'',asof,knowledge,p_context)');
 EXECUTE definition;
END $$;
ALTER FUNCTION rule_fact_contexts(timestamptz,timestamptz,boolean,uuid) RENAME TO rule_fact_contexts_base;
CREATE FUNCTION rule_fact_contexts(p_as_of timestamptz,p_knowledge timestamptz,p_projection boolean,p_animal_id uuid)
RETURNS TABLE(animal_id uuid,farm_id uuid,context jsonb) LANGUAGE sql STABLE AS $$
 WITH codes AS MATERIALIZED (
  SELECT coalesce(jsonb_agg(DISTINCT item),'[]'::jsonb) AS value FROM farm f
  CROSS JOIN LATERAL jsonb_path_query(rule_field_registry(f.id,p_as_of),'$.**.event') item
 ), cached AS MATERIALIZED (
  SELECT animal_id,farm_id,jsonb_object_agg(event_code,records) AS value
  FROM rule_bulk_event_contexts(p_as_of,p_knowledge,p_animal_id) GROUP BY animal_id,farm_id
 ) SELECT b.animal_id,b.farm_id,b.context||jsonb_build_object('_event_records',coalesce(c.value,'{}'::jsonb),'_cached_event_codes',codes.value)
 FROM rule_fact_contexts_base(p_as_of,p_knowledge,p_projection,p_animal_id)b CROSS JOIN codes
 LEFT JOIN cached c USING(animal_id,farm_id);
$$;
-- Existing SQL wrapper may retain its original function OID; explicitly rebind it.
CREATE OR REPLACE FUNCTION rule_fact_contexts(p_as_of timestamptz,p_knowledge timestamptz,p_projection boolean DEFAULT false)
RETURNS TABLE(animal_id uuid,farm_id uuid,context jsonb) LANGUAGE sql STABLE AS $$
 SELECT * FROM rule_fact_contexts(p_as_of,p_knowledge,p_projection,NULL);
$$;
UPDATE animal_rule_projection_snapshot SET stale=true WHERE singleton;
