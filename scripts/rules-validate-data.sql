\set ON_ERROR_STOP on
\timing on
SELECT count(*) AS initial_animals,md5(string_agg(id::text,',' ORDER BY id)) AS initial_ids FROM animal \gset
SELECT count(*) AS initial_events FROM animal_event \gset
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='120s';
SELECT count(*)=3 AS rules_migrated FROM schema_migrations WHERE name IN('013_rule_fields.sql','014_rule_projection_refresh.sql','015_rule_event_expressions.sql') \gset
\if :rules_migrated
\else
\ir '../db/migrations/013_rule_fields.sql'
\ir '../db/migrations/014_rule_projection_refresh.sql'
\ir '../db/migrations/015_rule_event_expressions.sql'
\endif
DO $$ BEGIN
 IF evaluate_rule_expression('{"op":"DATE_DIFF","left":{"op":"LITERAL","value":"2026-07-30"},"right":{"op":"LITERAL","value":"2026-09-04"}}','{}') <> '36'::jsonb THEN RAISE EXCEPTION 'date difference'; END IF;
 IF evaluate_rule_expression('{"op":"DIVIDE","left":{"op":"LITERAL","value":5},"right":{"op":"LITERAL","value":0}}','{}') IS NOT NULL THEN RAISE EXCEPTION 'division null'; END IF;
END $$;
\set fixture_date '2026-09-04'
\ir 'rules-test-data.sql'
\ir 'rules-boundary-data.sql'
SELECT clock_timestamp()::text AS fixture_as_of \gset
\ir 'rules-541-data.sql'
SET CONSTRAINTS ALL IMMEDIATE;
DO $$
DECLARE f record; ctx jsonb; expected bigint; actual jsonb;
BEGIN
 IF has_function_privilege('arka_reader','refresh_animal_rule_values(timestamptz,timestamptz)','EXECUTE') OR has_function_privilege('arka_reader','refresh_animal_state_query()','EXECUTE') OR has_function_privilege('arka_reader','refresh_animal_state_query_base(timestamptz)','EXECUTE') THEN RAISE EXCEPTION 'reader maintenance privilege'; END IF;
 SELECT * INTO f FROM rule_fixture_lactations LIMIT 1;
 ctx:=jsonb_build_object('animal_id',f.animal_id,'farm_id',f.farm_id,'as_of_timestamp',f.fixture_at,'knowledge_timestamp',f.fixture_at);
 SELECT count(*) INTO expected FROM effective_animal_events(f.fixture_at,f.fixture_at) WHERE animal_id=f.animal_id AND event_code='CALVED';
 actual:=evaluate_rule_expression('{"op":"EVENT_COUNT","event":"CALVED"}',ctx);
 IF actual<>to_jsonb(expected) THEN RAISE EXCEPTION 'generic count mismatch %, %',actual,expected; END IF;
 actual:=evaluate_rule_expression('{"op":"EVENT_DATE","event":"CALVED","order":"DESC","position":1}',ctx);
 IF actual IS NULL THEN RAISE EXCEPTION 'generic event date missing'; END IF;
 actual:=evaluate_rule_expression('{"op":"EVENT_VALUE","event":"EXTERNAL_ASSESSMENT","value":"value_numeric","where":{"assessment_kind":"MILK_305_FORECAST"}}',ctx);
 IF actual IS NULL THEN RAISE EXCEPTION 'generic event value missing'; END IF;
 actual:=evaluate_rule_expression('{"op":"EVENT_AGGREGATE","event":"EXTERNAL_ASSESSMENT","value":"value_numeric","aggregate":"SUM","where":{"assessment_kind":"MILK_305_FORECAST"}}',ctx);
 IF actual IS NULL THEN RAISE EXCEPTION 'generic event aggregate missing'; END IF;
 BEGIN PERFORM evaluate_rule_expression('{"op":"EVENT_VALUE","event":"CALVED","value":"unapproved_column"}',ctx); RAISE EXCEPTION 'unknown column incorrectly accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='unknown column incorrectly accepted' THEN RAISE; END IF; END;
END $$;
SELECT refresh_animal_state_query();
\ir 'rules-541-validate-data.sql'
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT b.*,s.rule_values FROM rule_boundary_cohort b JOIN animal_state_query s USING(animal_id,farm_id) LOOP
  IF c.rule_values->>'EAR_TAG' IS NULL THEN RAISE EXCEPTION 'boundary ear tag missing'; END IF;
  IF c.kind='insemination' AND (c.rule_values->>'SECOND_INSEMINATION_DATE_CURRENT_LACTATION')::date <> '2026-09-04'::date-21*(c.ordinal-1) THEN RAISE EXCEPTION 'second insemination fixture mismatch'; END IF;
  IF c.kind='exit' AND c.rule_values->>'LIFE_STATE'<>(CASE c.ordinal WHEN 1 THEN 'SOLD' ELSE 'DEAD' END) THEN RAISE EXCEPTION 'lifecycle fixture mismatch'; END IF;
 END LOOP;
END $$;
ROLLBACK;
SELECT count(*)=:'initial_animals'::bigint AND md5(string_agg(id::text,',' ORDER BY id))=:'initial_ids' AS animals_unchanged FROM animal;
SELECT count(*)=:'initial_events'::bigint AS events_unchanged FROM animal_event;
