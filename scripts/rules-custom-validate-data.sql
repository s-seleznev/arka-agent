\set ON_ERROR_STOP on
\timing on
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='120s';
SELECT count(*)=1 AS custom_migrated FROM schema_migrations WHERE name='016_custom_rule_fields.sql' \gset
\if :custom_migrated
\else
\ir '../db/migrations/016_custom_rule_fields.sql'
\endif
CREATE TEMP TABLE custom_test_facts ON COMMIT DROP AS
SELECT e.id AS original_event_id,e.farm_id,e.animal_id,e.occurred_at,e.recorded_at,v.field_definition_id,v.value_numeric
FROM custom_event_value v JOIN animal_event e ON (e.id,e.farm_id)=(v.event_id,v.farm_id)
JOIN field_definition fd ON fd.id=v.field_definition_id WHERE fd.code='TEMPERAMENT_SCORE';
INSERT INTO field_definition(id,code,name,scope,value_type,source_kind,is_system)
VALUES(md5('custom-test-derived')::uuid,'CUSTOM_TEST_PLUS_ONE','Test derived custom field','ANIMAL','NUMERIC','CALCULATED',true);
INSERT INTO calculated_field(id,field_definition_id,version,expression_ast,description,valid_from)
VALUES(md5('custom-test-derived-formula')::uuid,md5('custom-test-derived')::uuid,1,
 '{"op":"ADD","left":{"op":"FIELD","code":"TEMPERAMENT_SCORE"},"right":{"op":"LITERAL","value":1}}','Rollback test of real calculated_field dependency','2020-01-01Z');
SELECT refresh_animal_state_query();
DO $$ DECLARE f record; got jsonb; snapshot_at timestamptz; BEGIN
 SELECT as_of INTO snapshot_at FROM animal_rule_projection_snapshot;
 IF (SELECT count(*) FROM custom_test_facts)<>6 THEN RAISE EXCEPTION 'six baseline custom facts required'; END IF;
 FOR f IN SELECT * FROM custom_test_facts LOOP
  got:=field_value_at(f.animal_id,'TEMPERAMENT_SCORE',snapshot_at,snapshot_at);
  IF got IS DISTINCT FROM to_jsonb(f.value_numeric) THEN RAISE EXCEPTION 'direct custom mismatch'; END IF;
  got:=field_value_at(f.animal_id,'CUSTOM_TEST_PLUS_ONE',snapshot_at,snapshot_at);
  IF got IS DISTINCT FROM to_jsonb(f.value_numeric+1) THEN RAISE EXCEPTION 'FIELD dependency mismatch'; END IF;
  IF (SELECT rule_values->'TEMPERAMENT_SCORE' FROM animal_state_query WHERE animal_id=f.animal_id) IS DISTINCT FROM to_jsonb(f.value_numeric) THEN RAISE EXCEPTION 'custom projection mismatch'; END IF;
  IF (SELECT rule_values->'CUSTOM_TEST_PLUS_ONE' FROM animal_state_query WHERE animal_id=f.animal_id) IS DISTINCT FROM to_jsonb(f.value_numeric+1) THEN RAISE EXCEPTION 'derived projection mismatch'; END IF;
  IF field_value_at(f.animal_id,'TEMPERAMENT_SCORE',f.occurred_at-interval '1 microsecond',f.recorded_at) IS NOT NULL THEN RAISE EXCEPTION 'occurred boundary before'; END IF;
  IF field_value_at(f.animal_id,'TEMPERAMENT_SCORE',f.occurred_at,f.recorded_at-interval '1 microsecond') IS NOT NULL THEN RAISE EXCEPTION 'knowledge boundary before'; END IF;
  IF field_value_at(f.animal_id,'TEMPERAMENT_SCORE',f.occurred_at,f.recorded_at) IS DISTINCT FROM to_jsonb(f.value_numeric) THEN RAISE EXCEPTION 'exact boundary value'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM animal_state_query WHERE rule_values->'TEMPERAMENT_SCORE'<>'null'::jsonb)<>6 THEN RAISE EXCEPTION 'missing values must stay NULL'; END IF;
END $$;
-- RLS: a caller sees its own value and neither custom history nor fields of another farm.
GRANT SELECT ON custom_test_facts TO arka_reader;
DO $$ DECLARE f record; other_animal uuid; BEGIN
 FOR f IN SELECT * FROM custom_test_facts LOOP
  SELECT animal_id INTO other_animal FROM custom_test_facts WHERE farm_id<>f.farm_id LIMIT 1;
  EXECUTE 'SET LOCAL ROLE arka_reader';
  PERFORM set_config('arka.farm_ids',f.farm_id::text,true);
  IF field_value_at(f.animal_id,'TEMPERAMENT_SCORE',f.occurred_at,f.recorded_at) IS DISTINCT FROM to_jsonb(f.value_numeric) THEN RAISE EXCEPTION 'own custom not readable'; END IF;
  IF field_value_at(other_animal,'TEMPERAMENT_SCORE',clock_timestamp(),clock_timestamp()) IS NOT NULL THEN RAISE EXCEPTION 'foreign custom leaked'; END IF;
  IF (SELECT count(*) FROM rule_custom_contexts(clock_timestamp(),clock_timestamp()))<>1 THEN RAISE EXCEPTION 'custom farm scope leaked'; END IF;
  EXECUTE 'RESET ROLE';
 END LOOP;
END $$;
INSERT INTO animal_event(id,farm_id,animal_id,event_type_id,occurred_at,recorded_at,source_type,source_record_id,supersedes_event_id,comment)
SELECT md5('custom-test-correction:'||original_event_id)::uuid,farm_id,animal_id,md5('event-type:CUSTOM_EVENT_RECORDED')::uuid,occurred_at,recorded_at+interval '1 day','SIMULATION','custom-test-correction:'||original_event_id,original_event_id,'ROLLBACK TEST DATA'
FROM custom_test_facts;
INSERT INTO custom_event_value(event_id,farm_id,field_definition_id,value_numeric)
SELECT md5('custom-test-correction:'||original_event_id)::uuid,farm_id,field_definition_id,7 FROM custom_test_facts;
DO $$ DECLARE f record; BEGIN
 IF NOT (SELECT stale FROM animal_rule_projection_snapshot) THEN RAISE EXCEPTION 'custom correction did not invalidate projection'; END IF;
 FOR f IN SELECT * FROM custom_test_facts LOOP
  IF field_value_at(f.animal_id,'TEMPERAMENT_SCORE',f.occurred_at,f.recorded_at) IS DISTINCT FROM '4'::jsonb THEN RAISE EXCEPTION 'correction changed past knowledge'; END IF;
  IF field_value_at(f.animal_id,'TEMPERAMENT_SCORE',f.occurred_at,f.recorded_at+interval '1 day') IS DISTINCT FROM '7'::jsonb THEN RAISE EXCEPTION 'correction missing at knowledge boundary'; END IF;
 END LOOP;
END $$;
UPDATE animal_event SET voided_at=recorded_at+interval '12 hours' WHERE source_record_id LIKE 'custom-test-correction:%';
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT * FROM custom_test_facts LOOP
  IF field_value_at(f.animal_id,'TEMPERAMENT_SCORE',f.occurred_at,f.recorded_at+interval '36 hours'-interval '1 microsecond') IS DISTINCT FROM '7'::jsonb THEN RAISE EXCEPTION 'retraction before boundary'; END IF;
  IF field_value_at(f.animal_id,'TEMPERAMENT_SCORE',f.occurred_at,f.recorded_at+interval '36 hours') IS DISTINCT FROM '4'::jsonb THEN RAISE EXCEPTION 'retraction boundary must reveal predecessor'; END IF;
 END LOOP;
END $$;
INSERT INTO field_definition(id,farm_id,code,name,scope,value_type,source_kind,valid_from,definition_version)
SELECT md5('custom-test-version:'||field_definition_id)::uuid,farm_id,'TEMPERAMENT_SCORE','Version test','ANIMAL','NUMERIC','CUSTOM_EVENT_VALUE',recorded_at+interval '2 days',2 FROM custom_test_facts;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT * FROM custom_test_facts LOOP
  IF field_value_at(f.animal_id,'TEMPERAMENT_SCORE',f.recorded_at+interval '2 days',f.recorded_at+interval '2 days') IS NOT NULL THEN RAISE EXCEPTION 'new field definition inherited unrelated old values'; END IF;
 END LOOP;
END $$;
INSERT INTO animal_event(id,farm_id,animal_id,event_type_id,occurred_at,recorded_at,source_type,source_record_id,comment)
SELECT md5('custom-test-version-value:'||original_event_id)::uuid,farm_id,animal_id,md5('event-type:CUSTOM_EVENT_RECORDED')::uuid,recorded_at+interval '2 days',recorded_at+interval '2 days','SIMULATION','custom-test-version-value:'||original_event_id,'ROLLBACK TEST DATA' FROM custom_test_facts;
INSERT INTO custom_event_value(event_id,farm_id,field_definition_id,value_numeric)
SELECT md5('custom-test-version-value:'||original_event_id)::uuid,farm_id,md5('custom-test-version:'||field_definition_id)::uuid,11 FROM custom_test_facts;
-- Override a system code on exactly one farm, plus all declared storage types.
CREATE TEMP TABLE custom_type_fixture ON COMMIT DROP AS SELECT * FROM custom_test_facts ORDER BY farm_id LIMIT 1;
INSERT INTO field_definition(id,farm_id,code,name,scope,value_type,reference_kind,source_kind)
SELECT md5('custom-test-type:'||t.code)::uuid,f.farm_id,t.code,t.code,'ANIMAL',t.type,CASE WHEN t.type='REFERENCE' THEN 'ANIMAL' END,'CUSTOM_EVENT_VALUE'
FROM custom_type_fixture f CROSS JOIN (VALUES('AGE_DAYS','NUMERIC'),('CUSTOM_TEST_TEXT','TEXT'),('CUSTOM_TEST_ENUM','ENUM'),('CUSTOM_TEST_BOOLEAN','BOOLEAN'),('CUSTOM_TEST_DATE','DATE'),('CUSTOM_TEST_TIMESTAMP','TIMESTAMP'),('CUSTOM_TEST_REFERENCE','REFERENCE'),('CUSTOM_TEST_INTEGER','INTEGER'),('CUSTOM_TEST_BIG_INTEGER','INTEGER'))t(code,type);
INSERT INTO custom_event_value(event_id,farm_id,field_definition_id,value_numeric,value_text,value_boolean,value_date,value_timestamp,value_reference)
SELECT md5('custom-test-version-value:'||f.original_event_id)::uuid,f.farm_id,md5('custom-test-type:'||t.code)::uuid,
 CASE WHEN t.code='AGE_DAYS' THEN 20 WHEN t.code='CUSTOM_TEST_INTEGER' THEN 0 WHEN t.code='CUSTOM_TEST_BIG_INTEGER' THEN 9223372036854775808::numeric END,
 CASE WHEN t.code='CUSTOM_TEST_TEXT' THEN '' WHEN t.code='CUSTOM_TEST_ENUM' THEN 'EXAMPLE' END,
 CASE WHEN t.code='CUSTOM_TEST_BOOLEAN' THEN false END,
 CASE WHEN t.code='CUSTOM_TEST_DATE' THEN '2026-08-31'::date END,
 CASE WHEN t.code='CUSTOM_TEST_TIMESTAMP' THEN '2026-08-31T12:00:00Z'::timestamptz END,
 CASE WHEN t.code='CUSTOM_TEST_REFERENCE' THEN f.animal_id END
FROM custom_type_fixture f CROSS JOIN(VALUES('AGE_DAYS'),('CUSTOM_TEST_TEXT'),('CUSTOM_TEST_ENUM'),('CUSTOM_TEST_BOOLEAN'),('CUSTOM_TEST_DATE'),('CUSTOM_TEST_TIMESTAMP'),('CUSTOM_TEST_REFERENCE'),('CUSTOM_TEST_INTEGER'),('CUSTOM_TEST_BIG_INTEGER'))t(code);
DO $$ DECLARE f record; BEGIN
 SELECT * INTO f FROM custom_type_fixture;
 INSERT INTO field_definition(id,farm_id,code,name,scope,value_type,source_kind,source_ast)
 VALUES(md5('custom-test-not-custom')::uuid,f.farm_id,'CUSTOM_TEST_CALCULATED','Non-custom storage test','ANIMAL','NUMERIC','CALCULATED','{"op":"LITERAL","value":3}');
 BEGIN
  INSERT INTO custom_event_value(event_id,farm_id,field_definition_id,value_numeric)
  VALUES(md5('custom-test-version-value:'||f.original_event_id)::uuid,f.farm_id,md5('custom-test-not-custom')::uuid,3);
  RAISE EXCEPTION 'non-custom storage accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='non-custom storage accepted' THEN RAISE; END IF;
 END;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT refresh_animal_state_query();
DO $$ DECLARE f record; current_at timestamptz; code text; expected jsonb; projection jsonb; BEGIN
 SELECT as_of INTO current_at FROM animal_rule_projection_snapshot;
 FOR f IN SELECT * FROM custom_test_facts LOOP
  IF field_value_at(f.animal_id,'TEMPERAMENT_SCORE',current_at,current_at) IS DISTINCT FROM '11'::jsonb THEN RAISE EXCEPTION 'selected version direct'; END IF;
  IF (SELECT rule_values->'TEMPERAMENT_SCORE' FROM animal_state_query WHERE animal_id=f.animal_id) IS DISTINCT FROM '11'::jsonb THEN RAISE EXCEPTION 'selected version projection'; END IF;
  IF (SELECT rule_values->'CUSTOM_TEST_PLUS_ONE' FROM animal_state_query WHERE animal_id=f.animal_id) IS DISTINCT FROM '12'::jsonb THEN RAISE EXCEPTION 'updated dependency projection'; END IF;
 END LOOP;
 SELECT * INTO f FROM custom_type_fixture;
 SELECT rule_values INTO projection FROM animal_state_query WHERE animal_id=f.animal_id;
 FOR code,expected IN SELECT fd.code,rule_custom_value_json(v,fd.value_type) FROM custom_event_value v JOIN field_definition fd ON fd.id=v.field_definition_id WHERE fd.code LIKE 'CUSTOM_TEST_%' OR fd.id=md5('custom-test-type:AGE_DAYS')::uuid LOOP
  IF projection->code IS DISTINCT FROM expected OR field_value_at(f.animal_id,code,current_at,current_at) IS DISTINCT FROM expected THEN RAISE EXCEPTION 'typed custom mismatch: %',code; END IF;
 END LOOP;
 IF projection->'AGE_DAYS' IS DISTINCT FROM '20'::jsonb OR projection->'CUSTOM_TEST_BOOLEAN' IS DISTINCT FROM 'false'::jsonb OR projection->'CUSTOM_TEST_INTEGER' IS DISTINCT FROM '0'::jsonb OR projection->>'CUSTOM_TEST_TEXT' IS DISTINCT FROM '' THEN RAISE EXCEPTION 'false/zero/empty text lost'; END IF;
 IF (SELECT count(*) FROM animal_state_query WHERE farm_id<>f.farm_id AND rule_values->'AGE_DAYS'='20'::jsonb)<>0 THEN RAISE EXCEPTION 'farm override leaked'; END IF;
 IF projection->>'CUSTOM_TEST_BIG_INTEGER' IS DISTINCT FROM '9223372036854775808' THEN RAISE EXCEPTION 'integer precision lost'; END IF;
 IF has_function_privilege('arka_reader','refresh_animal_rule_values(timestamptz,timestamptz)','EXECUTE') THEN RAISE EXCEPTION 'reader maintenance privilege'; END IF;
END $$;
ROLLBACK;
SELECT count(*) AS animals,md5(string_agg(id::text,',' ORDER BY id)) AS ids FROM animal;
SELECT count(*) AS events FROM animal_event;
