\set ON_ERROR_STOP on
\timing on
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='120s';
SELECT count(*)=1 AS migrated FROM schema_migrations WHERE name='017_additional_rule_facts.sql' \gset
\if :migrated
\else
\ir '../db/migrations/017_additional_rule_facts.sql'
\endif
SELECT count(*)=1 AS migrated19 FROM schema_migrations WHERE name='019_bulk_rule_expressions.sql' \gset
\if :migrated19
\else
\ir '../db/migrations/019_bulk_rule_expressions.sql'
\endif
-- Independent direct joins select the effective event, rather than reusing the AST.
DO $$ DECLARE n integer; BEGIN
 WITH expected AS (
 SELECT s.animal_id,to_jsonb(b.birth_weight_kg) birth,to_jsonb((x.occurred_at AT TIME ZONE f.timezone)::date) exit_date,to_jsonb(m.milk_kg) milk
 FROM animal_state_query s JOIN farm f ON f.id=s.farm_id CROSS JOIN animal_rule_projection_snapshot p
 LEFT JOIN LATERAL(SELECT d.birth_weight_kg FROM effective_animal_events(p.as_of,p.knowledge_at)e JOIN event_birth d ON(d.event_id,d.farm_id)=(e.id,e.farm_id) WHERE e.animal_id=s.animal_id ORDER BY e.occurred_at DESC,e.recorded_at DESC,e.id DESC LIMIT 1)b ON true
 LEFT JOIN LATERAL(SELECT e.occurred_at FROM effective_animal_events(p.as_of,p.knowledge_at)e JOIN event_exit d ON(d.event_id,d.farm_id)=(e.id,e.farm_id) WHERE e.animal_id=s.animal_id ORDER BY e.occurred_at DESC,e.recorded_at DESC,e.id DESC LIMIT 1)x ON true
 LEFT JOIN LATERAL(SELECT d.milk_kg FROM effective_animal_events(p.as_of,p.knowledge_at)e JOIN event_milk_test d ON(d.event_id,d.farm_id)=(e.id,e.farm_id) WHERE e.animal_id=s.animal_id ORDER BY e.occurred_at DESC,e.recorded_at DESC,e.id DESC LIMIT 1)m ON true
 WHERE s.animal_id IN(SELECT DISTINCT ON(farm_id) animal_id FROM animal_state_query ORDER BY farm_id,animal_id)
 ) SELECT count(*) INTO n FROM expected e JOIN animal_state_query s USING(animal_id)
 WHERE s.rule_values->'BIRTH_WEIGHT_KG' IS DISTINCT FROM coalesce(e.birth,'null'::jsonb)
 OR s.rule_values->'EXIT_DATE' IS DISTINCT FROM coalesce(e.exit_date,'null'::jsonb)
 OR s.rule_values->'LAST_MILK_TEST_KG' IS DISTINCT FROM coalesce(e.milk,'null'::jsonb);
 IF n<>0 THEN RAISE EXCEPTION 'direct/projection discrepancy'; END IF;
END $$;
CREATE TEMP TABLE test_facts ON COMMIT DROP AS
SELECT DISTINCT ON(e.farm_id) e.animal_id,e.farm_id,e.id original_id,e.occurred_at,e.recorded_at,d.birth_weight_kg
FROM animal_event e JOIN event_birth d ON(d.event_id,d.farm_id)=(e.id,e.farm_id) ORDER BY e.farm_id,e.id;
-- Correction of existing birth facts, plus competing test/daily milk events, only within rollback.
INSERT INTO animal_event(id,animal_id,farm_id,event_type_id,occurred_at,recorded_at,supersedes_event_id,source_type,source_record_id)
SELECT md5('017-birth:'||original_id)::uuid,animal_id,farm_id,(SELECT id FROM event_type WHERE code='BORN' AND farm_id IS NULL),occurred_at,clock_timestamp(),original_id,'SIMULATION','birth:'||original_id FROM test_facts;
INSERT INTO event_birth(event_id,farm_id,birth_weight_kg) SELECT md5('017-birth:'||original_id)::uuid,farm_id,43.25 FROM test_facts;
INSERT INTO animal_event(id,animal_id,farm_id,event_type_id,occurred_at,recorded_at,source_type,source_record_id)
SELECT md5('017-milk:'||original_id)::uuid,animal_id,farm_id,(SELECT id FROM event_type WHERE code='MILK_TESTED' AND farm_id IS NULL),clock_timestamp()-interval '1 hour',clock_timestamp(),'SIMULATION','milk:'||original_id FROM test_facts;
INSERT INTO event_milk_test(event_id,farm_id,milk_kg) SELECT md5('017-milk:'||original_id)::uuid,farm_id,17.25 FROM test_facts;
INSERT INTO animal_event(id,animal_id,farm_id,event_type_id,occurred_at,recorded_at,source_type,source_record_id)
SELECT md5('017-daily:'||original_id)::uuid,animal_id,farm_id,(SELECT id FROM event_type WHERE code='DAILY_MILK_RECORDED' AND farm_id IS NULL),clock_timestamp()-interval '30 minutes',clock_timestamp(),'SIMULATION','017-daily:'||original_id FROM test_facts;
INSERT INTO event_daily_milk(event_id,farm_id,farm_date,milk_kg)
SELECT md5('017-daily:'||t.original_id)::uuid,t.farm_id,(clock_timestamp() AT TIME ZONE f.timezone)::date,99 FROM test_facts t JOIN farm f ON f.id=t.farm_id;
INSERT INTO field_definition(id,code,name,scope,value_type,source_kind,source_ast)
VALUES(md5('test-019-milk-prev')::uuid,'TEST_019_MILK_PREV','Rollback previous milk','ANIMAL','NUMERIC','CALCULATED','{"op":"EVENT_VALUE","event":"MILK_TESTED","value":"milk_kg","position":2,"order":"DESC"}'),
(md5('test-019-milk-missing')::uuid,'TEST_019_MILK_MISSING','Rollback missing nth','ANIMAL','NUMERIC','CALCULATED','{"op":"EVENT_VALUE","event":"MILK_TESTED","value":"milk_kg","position":9999,"order":"DESC"}');
-- Same occurred/recorded timestamps: larger ID wins DESC; latest value deliberately NULL.
INSERT INTO animal_event(id,animal_id,farm_id,event_type_id,occurred_at,recorded_at,source_type,source_record_id)
SELECT ('ffffffff-ffff-4fff-afff-'||left(replace(farm_id::text,'-',''),12))::uuid,animal_id,farm_id,event_type_id,occurred_at,recorded_at,'SIMULATION','019-null-tie:'||id FROM animal_event WHERE id IN(SELECT md5('017-milk:'||original_id)::uuid FROM test_facts);
INSERT INTO event_milk_test(event_id,farm_id,milk_kg)
SELECT ('ffffffff-ffff-4fff-afff-'||left(replace(farm_id::text,'-',''),12))::uuid,farm_id,NULL FROM test_facts;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT refresh_animal_state_query();
DO $$ DECLARE t record;p record;ctx jsonb;BEGIN
 SELECT * INTO p FROM animal_rule_projection_snapshot;
 FOR t IN SELECT * FROM test_facts LOOP
  IF field_value_at(t.animal_id,'BIRTH_WEIGHT_KG',p.as_of,p.knowledge_at) IS DISTINCT FROM '43.25'::jsonb THEN RAISE EXCEPTION 'birth correction'; END IF;
  IF field_value_at(t.animal_id,'BIRTH_WEIGHT_KG',t.occurred_at,t.recorded_at) IS DISTINCT FROM to_jsonb(t.birth_weight_kg) THEN RAISE EXCEPTION 'birth past knowledge'; END IF;
  IF field_value_at(t.animal_id,'LAST_MILK_TEST_KG',p.as_of,p.knowledge_at) IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'milk test selection'; END IF;
  IF (SELECT rule_values->'LAST_MILK_TEST_KG' FROM animal_state_query WHERE animal_id=t.animal_id) IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'milk projection'; END IF;
  SELECT context INTO ctx FROM rule_fact_contexts(p.as_of,p.knowledge_at,false,t.animal_id);
  IF evaluate_rule_expression('{"op":"EVENT_COUNT","event":"MILK_TESTED"}',ctx) IS DISTINCT FROM evaluate_rule_expression('{"op":"EVENT_COUNT","event":"MILK_TESTED"}',ctx-'_cached_event_codes'-'_event_records') THEN RAISE EXCEPTION 'cache eventcount parity'; END IF;
 END LOOP;
END $$;
-- Latest milk test with absent yield remains NULL; it must not fall back to an older test or daily milk.
UPDATE event_milk_test SET milk_kg=NULL WHERE event_id IN(SELECT md5('017-milk:'||original_id)::uuid FROM test_facts);
DO $$ DECLARE t record;BEGIN
 FOR t IN SELECT * FROM test_facts LOOP
  IF field_value_at(t.animal_id,'LAST_MILK_TEST_KG',clock_timestamp(),clock_timestamp()) IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'latest null milk must not be skipped'; END IF;
 END LOOP;
 FOR t IN SELECT DISTINCT ON(e.farm_id) e.animal_id,e.farm_id,e.occurred_at,e.recorded_at,f.timezone FROM animal_event e JOIN event_exit d ON(d.event_id,d.farm_id)=(e.id,e.farm_id) JOIN farm f ON f.id=e.farm_id ORDER BY e.farm_id,e.occurred_at DESC LOOP
  IF field_value_at(t.animal_id,'EXIT_DATE',t.occurred_at,t.recorded_at) IS DISTINCT FROM to_jsonb((t.occurred_at AT TIME ZONE t.timezone)::date) THEN RAISE EXCEPTION 'exit exact/localdate'; END IF;
  EXECUTE 'SET LOCAL ROLE arka_reader';
  PERFORM set_config('arka.farm_id',t.farm_id::text,true);PERFORM set_config('arka.farm_ids',t.farm_id::text,true);
  IF field_value_at(t.animal_id,'EXIT_DATE',t.occurred_at,t.recorded_at) IS DISTINCT FROM to_jsonb((t.occurred_at AT TIME ZONE t.timezone)::date) THEN RAISE EXCEPTION 'exit reader scope'; END IF;
  EXECUTE 'RESET ROLE';
 END LOOP;
END $$;
DO $$ DECLARE t record;p record;c jsonb;ast jsonb;BEGIN
 SELECT * INTO p FROM animal_rule_projection_snapshot;
 FOR t IN SELECT * FROM test_facts LOOP
  IF (SELECT rule_values->'TEST_019_MILK_PREV' FROM animal_state_query WHERE animal_id=t.animal_id) IS DISTINCT FROM '17.25'::jsonb THEN RAISE EXCEPTION 'tie previous value lost'; END IF;
  IF (SELECT rule_values->'TEST_019_MILK_MISSING' FROM animal_state_query WHERE animal_id=t.animal_id) IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'missing nth must NULL'; END IF;
  SELECT context INTO c FROM rule_fact_contexts(p.as_of,p.knowledge_at,false,t.animal_id);
  FOR ast IN SELECT a.ast FROM rule_batch_asts(p.as_of)a WHERE a.farm_id=t.farm_id LOOP
   -- Direct NULL updates above deliberately differ from projection, compare the same current fact cut here.
   IF evaluate_rule_expression(ast,c) IS DISTINCT FROM evaluate_rule_expression(ast,c-'_cached_expression_keys'-'_event_expression_values') THEN RAISE EXCEPTION 'fixture batch/fallback discrepancy'; END IF;
  END LOOP;
 END LOOP;
END $$;
DO $$ DECLARE t record;p record;c jsonb;r record;projected jsonb;BEGIN
 SELECT * INTO p FROM animal_rule_projection_snapshot;
 FOR t IN SELECT * FROM test_facts LOOP
  SELECT context INTO c FROM rule_fact_contexts(p.as_of,p.knowledge_at,false,t.animal_id);
  SELECT rule_values INTO projected FROM animal_state_query WHERE animal_id=t.animal_id;
  FOR r IN SELECT * FROM jsonb_each(rule_field_registry(t.farm_id,p.as_of)) WHERE key NOT LIKE 'TEST_%' LOOP
   IF projected->r.key IS DISTINCT FROM coalesce(evaluate_rule_expression(r.value,c),'null'::jsonb) THEN RAISE EXCEPTION 'all root field projection mismatch %',r.key; END IF;
  END LOOP;
 END LOOP;
END $$;
ROLLBACK;
SELECT count(*) animals,md5(string_agg(id::text,',' ORDER BY id)) ids FROM animal;
SELECT count(*) events FROM animal_event;
