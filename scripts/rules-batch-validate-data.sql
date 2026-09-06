\set ON_ERROR_STOP on
\timing on
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='180s';
SELECT count(*)=1 AS migrated17 FROM schema_migrations WHERE name='017_additional_rule_facts.sql' \gset
\if :migrated17
\else
\ir '../db/migrations/017_additional_rule_facts.sql'
\endif
SELECT count(*)=1 AS migrated18 FROM schema_migrations WHERE name='018_additional_rule_dates.sql' \gset
\if :migrated18
\else
\ir '../db/migrations/018_additional_rule_dates.sql'
\endif
SELECT count(*)=1 AS migrated19 FROM schema_migrations WHERE name='019_bulk_rule_expressions.sql' \gset
\if :migrated19
\else
\ir '../db/migrations/019_bulk_rule_expressions.sql'
\endif
SELECT refresh_animal_state_query();
CREATE TEMP TABLE expected_dates ON COMMIT DROP AS
WITH effective AS MATERIALIZED(SELECT e.* FROM animal_rule_projection_snapshot p,effective_animal_events(p.as_of,p.knowledge_at)e),
calving AS (SELECT DISTINCT ON(e.animal_id)e.animal_id,e.occurred_at,d.difficulty FROM effective e JOIN event_calving d ON(d.event_id,d.farm_id)=(e.id,e.farm_id) ORDER BY e.animal_id,e.occurred_at DESC,e.recorded_at DESC,e.id DESC),
insemination AS (SELECT e.animal_id,e.occurred_at,row_number()OVER(PARTITION BY e.animal_id ORDER BY e.occurred_at,e.recorded_at,e.id) n FROM effective e JOIN calving c ON c.animal_id=e.animal_id AND e.occurred_at>=c.occurred_at WHERE e.event_code='INSEMINATED'),
weight AS(SELECT e.animal_id,e.occurred_at,row_number()OVER(PARTITION BY e.animal_id ORDER BY e.occurred_at DESC,e.recorded_at DESC,e.id DESC)n FROM effective e JOIN event_measurement d ON(d.event_id,d.farm_id)=(e.id,e.farm_id) WHERE d.measurement_code='WEIGHT'),
exit AS(SELECT DISTINCT ON(e.animal_id)e.animal_id,d.reason FROM effective e JOIN event_exit d ON(d.event_id,d.farm_id)=(e.id,e.farm_id) ORDER BY e.animal_id,e.occurred_at DESC,e.recorded_at DESC,e.id DESC)
SELECT s.animal_id,s.farm_id,jsonb_build_object(
 'EXIT_REASON',x.reason,'FIRST_INSEMINATION_DATE_CURRENT_LACTATION',(i1.occurred_at AT TIME ZONE f.timezone)::date,
 'THIRD_INSEMINATION_DATE_CURRENT_LACTATION',(i3.occurred_at AT TIME ZONE f.timezone)::date,
 'LAST_WEIGHT_DATE',(w1.occurred_at AT TIME ZONE f.timezone)::date,'PREVIOUS_WEIGHT_DATE',(w2.occurred_at AT TIME ZONE f.timezone)::date,
 'LAST_CALVING_DIFFICULTY',c.difficulty,'CURRENT_LACTATION_START_DATE',(c.occurred_at AT TIME ZONE f.timezone)::date) values
 FROM animal_state_query s JOIN farm f ON f.id=s.farm_id LEFT JOIN calving c ON c.animal_id=s.animal_id
 LEFT JOIN insemination i1 ON i1.animal_id=s.animal_id AND i1.n=1 LEFT JOIN insemination i3 ON i3.animal_id=s.animal_id AND i3.n=3
 LEFT JOIN weight w1 ON w1.animal_id=s.animal_id AND w1.n=1 LEFT JOIN weight w2 ON w2.animal_id=s.animal_id AND w2.n=2
 LEFT JOIN exit x ON x.animal_id=s.animal_id;
DO $$ DECLARE n integer;t record;code text;p record;BEGIN
 SELECT count(*) INTO n FROM expected_dates e JOIN animal_state_query s USING(animal_id,farm_id) CROSS JOIN LATERAL jsonb_each(e.values)v
 WHERE s.rule_values->v.key IS DISTINCT FROM v.value;
 IF n<>0 THEN RAISE EXCEPTION 'independent all-animal date projection mismatch %',n; END IF;
 SELECT * INTO p FROM animal_rule_projection_snapshot;
 FOR t IN SELECT DISTINCT ON(farm_id)* FROM expected_dates WHERE values->>'THIRD_INSEMINATION_DATE_CURRENT_LACTATION' IS NOT NULL ORDER BY farm_id,animal_id LOOP
  FOR code IN SELECT jsonb_object_keys(t.values) LOOP
   IF field_value_at(t.animal_id,code,p.as_of,p.knowledge_at) IS DISTINCT FROM nullif(t.values->code,'null'::jsonb) AND field_value_at(t.animal_id,code,p.as_of,p.knowledge_at) IS DISTINCT FROM t.values->code THEN RAISE EXCEPTION 'direct field mismatch %',code; END IF;
  END LOOP;
 END LOOP;
 IF (SELECT count(DISTINCT farm_id) FROM expected_dates WHERE values->>'THIRD_INSEMINATION_DATE_CURRENT_LACTATION' IS NOT NULL)<>6 THEN RAISE EXCEPTION 'third insemination sixfarm controls required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM expected_dates WHERE values->>'CURRENT_LACTATION_START_DATE' IS NULL AND values->>'FIRST_INSEMINATION_DATE_CURRENT_LACTATION' IS NULL) THEN RAISE EXCEPTION 'no-calving NULL control absent'; END IF;
END $$;
-- Compare the batch fast path with the original event provider on the same pinned cut.
DO $$ DECLARE t record;a record;p record;c jsonb;fast jsonb;slow jsonb;BEGIN
 SELECT * INTO p FROM animal_rule_projection_snapshot;
 FOR t IN SELECT DISTINCT ON(farm_id)* FROM expected_dates WHERE values->>'THIRD_INSEMINATION_DATE_CURRENT_LACTATION' IS NOT NULL ORDER BY farm_id,animal_id LOOP
  SELECT context INTO c FROM rule_fact_contexts(p.as_of,p.knowledge_at,false,t.animal_id);
  FOR a IN SELECT * FROM rule_batch_asts(p.as_of) WHERE farm_id=t.farm_id LOOP
   fast:=evaluate_rule_expression(a.ast,c);slow:=evaluate_rule_expression(a.ast,c-'_cached_expression_keys'-'_event_expression_values');
   IF fast IS DISTINCT FROM slow THEN RAISE EXCEPTION 'fast/fallback mismatch %',a.ast; END IF;
  END LOOP;
 END LOOP;
END $$;
ROLLBACK;
SELECT count(*) animals,md5(string_agg(id::text,',' ORDER BY id)) ids FROM animal;
SELECT count(*) events FROM animal_event;
