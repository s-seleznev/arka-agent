\set ON_ERROR_STOP on
BEGIN;

-- Fixed farm-local dates: 7D is [03.09,10.09), 10D is [31.08,10.09).
-- Every write is rolled back. This compares raw effective rows, batch values,
-- and the scalar event interpreter bypassing the batch cache, without an LLM.
CREATE TEMP TABLE wf(farm_id uuid,animal_id uuid,zero_animal_id uuid,as_of timestamptz) ON COMMIT DROP;
INSERT INTO wf
SELECT f.id,md5('window-boundary:milk')::uuid,md5('window-boundary:zero')::uuid,'2026-09-10 12:00:00+03'
FROM farm f ORDER BY f.id LIMIT 1;
INSERT INTO animal(id,farm_id,name,sex,birth_date,origin)
SELECT animal_id,farm_id,'window-boundary-milk','FEMALE',DATE '2020-01-01','IMPORTED' FROM wf
UNION ALL SELECT zero_animal_id,farm_id,'window-boundary-zero','FEMALE',DATE '2020-01-01','IMPORTED' FROM wf;

-- 30.08 is outside 10D; 31.08 is its included lower boundary.
-- 02.09 is outside 7D; 03.09 is its included lower boundary; 10.09 is excluded.
INSERT INTO animal_event(id,farm_id,animal_id,event_type_id,occurred_at,recorded_at,source_type,source_record_id)
SELECT x.id,w.farm_id,w.animal_id,md5('event-type:DAILY_MILK_RECORDED')::uuid,x.occurred_at,x.occurred_at+interval '1 hour','SIMULATION',x.label
FROM wf w CROSS JOIN (VALUES
 ('00000000-0000-0000-0000-000000000130'::uuid,'2026-08-30 12:00+03'::timestamptz,'window:08-30'),
 ('00000000-0000-0000-0000-000000000131'::uuid,'2026-08-31 12:00+03'::timestamptz,'window:08-31'),
 ('00000000-0000-0000-0000-000000000101'::uuid,'2026-09-01 12:00+03'::timestamptz,'window:09-01'),
 ('00000000-0000-0000-0000-000000000102'::uuid,'2026-09-02 12:00+03'::timestamptz,'window:09-02'),
 ('00000000-0000-0000-0000-000000000103'::uuid,'2026-09-03 12:00+03'::timestamptz,'window:09-03'),
 ('00000000-0000-0000-0000-000000000109'::uuid,'2026-09-09 12:00+03'::timestamptz,'window:09-09'),
 ('00000000-0000-0000-0000-000000000110'::uuid,'2026-09-10 12:00+03'::timestamptz,'window:09-10')) x(id,occurred_at,label);
INSERT INTO event_daily_milk(event_id,farm_id,farm_date,milk_kg)
SELECT x.id,w.farm_id,x.farm_date,x.milk_kg FROM wf w CROSS JOIN (VALUES
 ('00000000-0000-0000-0000-000000000130'::uuid,'2026-08-30'::date,1000::numeric),
 ('00000000-0000-0000-0000-000000000131'::uuid,'2026-08-31'::date,50::numeric),
 ('00000000-0000-0000-0000-000000000101'::uuid,'2026-09-01'::date,30::numeric),
 ('00000000-0000-0000-0000-000000000102'::uuid,'2026-09-02'::date,40::numeric),
 ('00000000-0000-0000-0000-000000000103'::uuid,'2026-09-03'::date,10::numeric),
 ('00000000-0000-0000-0000-000000000109'::uuid,'2026-09-09'::date,20::numeric),
 ('00000000-0000-0000-0000-000000000110'::uuid,'2026-09-10'::date,100::numeric)) x(id,farm_date,milk_kg);

DO $$ DECLARE w record; raw7 numeric; raw10 numeric; scalar7 jsonb; scalar10 jsonb; batch7 jsonb; batch10 jsonb; k7 text; k10 text; ctx jsonb; BEGIN
 SELECT * INTO w FROM wf;
 SELECT avg(d.milk_kg) FILTER (WHERE d.farm_date BETWEEN DATE '2026-09-03' AND DATE '2026-09-09'),
        avg(d.milk_kg) FILTER (WHERE d.farm_date BETWEEN DATE '2026-08-31' AND DATE '2026-09-09')
 INTO raw7,raw10
 FROM event_daily_milk d JOIN animal_event e ON (e.id,e.farm_id)=(d.event_id,d.farm_id)
 WHERE e.animal_id=w.animal_id AND e.farm_id=w.farm_id;
 SELECT context INTO ctx FROM rule_fact_contexts(w.as_of,w.as_of,false,w.animal_id);
 SELECT evaluate_rule_expression_events(source_ast,ctx,'{}') INTO scalar7 FROM field_definition WHERE farm_id IS NULL AND code='AVG_DAILY_MILK_7D';
 SELECT evaluate_rule_expression_events(source_ast,ctx,'{}') INTO scalar10 FROM field_definition WHERE farm_id IS NULL AND code='AVG_DAILY_MILK_10D';
 SELECT max(expression_key) FILTER (WHERE ast->>'event'='DAILY_MILK_RECORDED' AND ast->>'value'='milk_kg' AND ast->>'aggregate'='AVG' AND (ast->'from'->'right'->>'value')='-7'),
        max(expression_key) FILTER (WHERE ast->>'event'='DAILY_MILK_RECORDED' AND ast->>'value'='milk_kg' AND ast->>'aggregate'='AVG' AND (ast->'from'->'right'->>'value')='-10') INTO k7,k10 FROM rule_batch_asts(w.as_of) WHERE farm_id=w.farm_id;
 SELECT expression_values->k7,expression_values->k10 INTO batch7,batch10 FROM rule_batch_event_values(w.as_of,w.as_of,w.animal_id) WHERE animal_id=w.animal_id;
 IF raw7 IS DISTINCT FROM 15 OR raw10 IS DISTINCT FROM 30 OR scalar7 IS DISTINCT FROM '15'::jsonb OR scalar10 IS DISTINCT FROM '30'::jsonb OR batch7 IS DISTINCT FROM '15'::jsonb OR batch10 IS DISTINCT FROM '30'::jsonb THEN RAISE EXCEPTION 'window mismatch raw=(%,%) scalar=(%,%) batch=(%,%)',raw7,raw10,scalar7,scalar10,batch7,batch10; END IF;
END $$;

-- Same-date DESC tie: the larger deterministic id must win for EVENT_VALUE.
INSERT INTO animal_event(id,farm_id,animal_id,event_type_id,occurred_at,recorded_at,source_type,source_record_id)
SELECT '00000000-0000-0000-0000-000000000190'::uuid,w.farm_id,w.animal_id,md5('event-type:CALVED')::uuid,'2026-01-01 12:00+03','2026-01-01 13:00+03','SIMULATION','window:calved' FROM wf w;
INSERT INTO event_calving(event_id,farm_id,offspring_count,live_offspring_count)
SELECT '00000000-0000-0000-0000-000000000190'::uuid,w.farm_id,1,1 FROM wf w;
INSERT INTO animal_event(id,farm_id,animal_id,event_type_id,occurred_at,recorded_at,source_type,source_record_id)
SELECT x.id,w.farm_id,w.animal_id,md5('event-type:MILK_TESTED')::uuid,'2026-09-05 12:00+03','2026-09-05 13:00+03', 'SIMULATION',x.label FROM wf w CROSS JOIN (VALUES
 ('00000000-0000-0000-0000-000000000201'::uuid,'window:test:1'),('00000000-0000-0000-0000-000000000202'::uuid,'window:test:2')) x(id,label);
INSERT INTO event_milk_test(event_id,farm_id,urea)
SELECT x.id,w.farm_id,x.urea FROM wf w CROSS JOIN (VALUES
 ('00000000-0000-0000-0000-000000000201'::uuid,11::numeric),('00000000-0000-0000-0000-000000000202'::uuid,22::numeric)) x(id,urea);
DO $$ DECLARE w record; v jsonb; BEGIN SELECT * INTO w FROM wf; SELECT field_value_at(w.animal_id,'LAST_MILK_TEST_UREA',w.as_of,w.as_of) INTO v; IF v IS DISTINCT FROM '22'::jsonb THEN RAISE EXCEPTION 'DESC tie mismatch: %',v; END IF; END $$;

-- Zero count and no six-farm multiplication.
DO $$ DECLARE w record; v jsonb; k text; b jsonb; BEGIN
 SELECT * INTO w FROM wf;
 SELECT field_value_at(w.zero_animal_id,'INSEMINATION_COUNT_CURRENT_LACTATION',w.as_of,w.as_of) INTO v;
 SELECT max(expression_key) INTO k FROM rule_batch_asts(w.as_of) WHERE farm_id=w.farm_id AND ast->>'op'='EVENT_COUNT' AND ast->>'event'='INSEMINATED';
 SELECT expression_values->k INTO b FROM rule_batch_event_values(w.as_of,w.as_of,w.zero_animal_id) WHERE animal_id=w.zero_animal_id;
 IF v IS DISTINCT FROM '0'::jsonb OR b IS DISTINCT FROM '0'::jsonb THEN RAISE EXCEPTION 'zero count mismatch scalar=%,batch=%',v,b; END IF;
END $$;

ROLLBACK;
