\set ON_ERROR_STOP on
BEGIN;

-- All rows are deterministic and rolled back at the end. This is a SQL-only
-- boundary test; it does not claim an LLM/e2e result.
CREATE TEMP TABLE ovsynch_fixture(
  label text PRIMARY KEY, animal_id uuid, assignment_id uuid,
  step_id uuid, expected_date date, expect_day boolean
) ON COMMIT DROP;
INSERT INTO ovsynch_fixture VALUES
 ('active',       md5('assignment-boundary:active')::uuid,       md5('assignment-boundary:active:assignment')::uuid,       md5('assignment-boundary:active:step')::uuid,       DATE '2026-09-04', true),
 ('other-animal', md5('assignment-boundary:other-animal')::uuid, md5('assignment-boundary:other-animal:assignment')::uuid, md5('assignment-boundary:other-animal:step')::uuid, NULL, false),
 ('completed',    md5('assignment-boundary:completed')::uuid,    md5('assignment-boundary:completed:assignment')::uuid,    md5('assignment-boundary:completed:step')::uuid,    NULL, false),
 ('cancelled',    md5('assignment-boundary:cancelled')::uuid,    md5('assignment-boundary:cancelled:assignment')::uuid,    md5('assignment-boundary:cancelled:step')::uuid,    NULL, false),
 ('superseded',   md5('assignment-boundary:superseded')::uuid,   md5('assignment-boundary:superseded:assignment')::uuid,   md5('assignment-boundary:superseded:step')::uuid,   NULL, false),
 ('voided',       md5('assignment-boundary:voided')::uuid,       md5('assignment-boundary:voided:assignment')::uuid,       md5('assignment-boundary:voided:step')::uuid,       NULL, false);

CREATE TEMP TABLE ovsynch_ids AS
SELECT (SELECT id FROM farm ORDER BY id LIMIT 1) farm_id,
       md5('protocol:OVSYNCH:1')::uuid protocol_id,
       md5('step:OVSYNCH:GNRH1')::uuid step_definition_id,
       md5('event-type:PROTOCOL_ASSIGNED')::uuid assigned_type,
       md5('event-type:PROTOCOL_STARTED')::uuid started_type,
       md5('event-type:PROTOCOL_STEP_COMPLETED')::uuid step_type,
       md5('event-type:PROTOCOL_COMPLETED')::uuid completed_type,
       md5('event-type:PROTOCOL_CANCELLED')::uuid cancelled_type;

INSERT INTO animal(id,farm_id,name,sex,birth_date,origin)
SELECT f.animal_id,i.farm_id,'fixture-'||f.label,'FEMALE',DATE '2020-01-01','IMPORTED'
FROM ovsynch_fixture f CROSS JOIN ovsynch_ids i;

-- Assignment + GNRH1 step for every case. The step on other-animal below is
-- deliberately linked to active's assignment to prove animal identity guard.
INSERT INTO animal_event(id,farm_id,animal_id,event_type_id,occurred_at,recorded_at,source_type,source_record_id)
SELECT f.assignment_id,i.farm_id,f.animal_id,i.assigned_type,'2026-09-01 09:00-03','2026-09-01 10:00-03','SIMULATION','fixture:'||f.label||':assignment'
FROM ovsynch_fixture f CROSS JOIN ovsynch_ids i;
INSERT INTO event_protocol_assignment(event_id,farm_id,protocol_id,purpose,planned_start_at)
SELECT f.assignment_id,i.farm_id,i.protocol_id,'fixture','2026-09-01 09:00-03'
FROM ovsynch_fixture f CROSS JOIN ovsynch_ids i;

-- The positive case has an explicit current status; NULL status must not pass
-- the breeding predicate.
INSERT INTO animal_event(id,farm_id,animal_id,event_type_id,occurred_at,recorded_at,source_type,source_record_id)
SELECT md5('assignment-boundary:active:status')::uuid,i.farm_id,f.animal_id,md5('event-type:STATUS_CHANGED')::uuid,'2026-09-01 11:00-03','2026-09-01 12:00-03','SIMULATION','fixture:active:status'
FROM ovsynch_fixture f CROSS JOIN ovsynch_ids i WHERE f.label='active';
INSERT INTO event_status_change(event_id,farm_id,new_status_id,reason)
SELECT md5('assignment-boundary:active:status')::uuid,i.farm_id,'7d61c5f6-c2fa-1fdf-e129-bc4d7c081808'::uuid,'fixture'
FROM ovsynch_fixture f CROSS JOIN ovsynch_ids i WHERE f.label='active';

INSERT INTO animal_event(id,farm_id,animal_id,event_type_id,occurred_at,recorded_at,source_type,source_record_id)
SELECT f.step_id,i.farm_id,f.animal_id,i.step_type,'2026-09-04 09:00-03','2026-09-04 10:00-03','SIMULATION','fixture:'||f.label||':step'
FROM ovsynch_fixture f CROSS JOIN ovsynch_ids i;
INSERT INTO event_protocol_step(event_id,farm_id,assignment_event_id,step_definition_id,completed_at)
SELECT f.step_id,i.farm_id,f.assignment_id,i.step_definition_id,CASE WHEN f.label='other-animal' THEN '2026-09-04 11:00-03'::timestamptz ELSE '2026-09-04 09:00-03'::timestamptz END
FROM ovsynch_fixture f CROSS JOIN ovsynch_ids i;

-- Start only the positive assignment; day 1 is actual_start_at's local date.
INSERT INTO animal_event(id,farm_id,animal_id,event_type_id,occurred_at,recorded_at,source_type,source_record_id)
SELECT md5('assignment-boundary:active:start')::uuid,i.farm_id,f.animal_id,i.started_type,'2026-09-01 09:00-03','2026-09-01 10:00-03','SIMULATION','fixture:active:start'
FROM ovsynch_fixture f CROSS JOIN ovsynch_ids i WHERE f.label='active';
INSERT INTO event_protocol_start(event_id,farm_id,assignment_event_id,actual_start_at,day_origin,provenance)
SELECT md5('assignment-boundary:active:start')::uuid,i.farm_id,f.assignment_id,'2026-09-01 09:00-03',0,'rollback fixture'
FROM ovsynch_fixture f CROSS JOIN ovsynch_ids i WHERE f.label='active';

-- Positive control must remain linked to the same animal and assignment.
DO $$ DECLARE active_id uuid; v jsonb; BEGIN
 SELECT assignment_id INTO active_id FROM ovsynch_fixture WHERE label='active';
 SELECT field_value_at((SELECT animal_id FROM ovsynch_fixture WHERE label='active'),'CURRENT_OVSYNCH_GNRH1_DATE','2026-09-04 12:00-03'::timestamptz,'2026-09-04 12:00-03'::timestamptz) INTO v;
 IF v IS DISTINCT FROM '"2026-09-04"'::jsonb THEN RAISE EXCEPTION 'active GNRH1 mismatch: %',v; END IF;
 SELECT field_value_at((SELECT animal_id FROM ovsynch_fixture WHERE label='active'),'CURRENT_OVSYNCH_START_DATE','2026-09-04 12:00-03'::timestamptz,'2026-09-04 12:00-03'::timestamptz) INTO v;
 IF v IS DISTINCT FROM '"2026-09-01"'::jsonb THEN RAISE EXCEPTION 'active start mismatch: %',v; END IF;
 SELECT field_value_at((SELECT animal_id FROM ovsynch_fixture WHERE label='active'),'CURRENT_OVSYNCH_DAY','2026-09-04 12:00-03'::timestamptz,'2026-09-04 12:00-03'::timestamptz) INTO v;
 IF v IS DISTINCT FROM '4'::jsonb THEN RAISE EXCEPTION 'active day mismatch: %',v; END IF;
 SELECT field_value_at((SELECT animal_id FROM ovsynch_fixture WHERE label='active'),'CURRENT_OVSYNCH_DAY','2026-09-10 12:00-03'::timestamptz,'2026-09-10 12:00-03'::timestamptz) INTO v;
 IF v IS DISTINCT FROM '10'::jsonb THEN RAISE EXCEPTION 'day-10 mismatch: %',v; END IF;
 SELECT jsonb_build_array(context->'current_ovsynch_ai_date',context->'is_pregnant',context->'is_exited',context->'status_code')
 INTO v FROM rule_fact_contexts('2026-09-10 12:00-03','2026-09-10 12:00-03',false,(SELECT animal_id FROM ovsynch_fixture WHERE label='active'));
 IF v->0 IS DISTINCT FROM 'null'::jsonb OR v->1 IS DISTINCT FROM 'false'::jsonb OR v->2 IS DISTINCT FROM 'false'::jsonb OR v->3 = '"DO_NOT_INSEMINATE"'::jsonb THEN
  RAISE EXCEPTION 'day-10 selection guards mismatch: %',v;
 END IF;
 IF (SELECT count(*) FROM rule_fact_contexts('2026-09-10 12:00-03','2026-09-10 12:00-03',false,(SELECT animal_id FROM ovsynch_fixture WHERE label='active')) r
     WHERE r.context->>'current_ovsynch_day'='10'
       AND r.context->>'current_ovsynch_breeding_allowed'='true'
       AND r.context->>'current_ovsynch_ai_date' IS NULL
       AND r.context->>'is_pregnant'='false'
       AND r.context->>'is_exited'='false') <> 1 THEN
  RAISE EXCEPTION 'positive day-10 selection did not match exactly once';
 END IF;
END $$;

-- A completed AI step removes the same animal from the positive queue.
INSERT INTO animal_event(id,farm_id,animal_id,event_type_id,occurred_at,recorded_at,source_type,source_record_id)
SELECT md5('assignment-boundary:active:ai')::uuid,i.farm_id,f.animal_id,i.step_type,'2026-09-10 09:00-03','2026-09-10 10:00-03','SIMULATION','fixture:active:ai'
FROM ovsynch_fixture f CROSS JOIN ovsynch_ids i WHERE f.label='active';
INSERT INTO event_protocol_step(event_id,farm_id,assignment_event_id,step_definition_id,completed_at)
SELECT md5('assignment-boundary:active:ai')::uuid,i.farm_id,f.assignment_id,md5('step:OVSYNCH:AI')::uuid,'2026-09-10 09:00-03'
FROM ovsynch_fixture f CROSS JOIN ovsynch_ids i WHERE f.label='active';
DO $$ BEGIN
 IF (SELECT count(*) FROM rule_fact_contexts('2026-09-10 12:00-03','2026-09-10 12:00-03',false,(SELECT animal_id FROM ovsynch_fixture WHERE label='active')) r
     WHERE r.context->>'current_ovsynch_day'='10' AND r.context->>'current_ovsynch_ai_date' IS NULL) <> 0 THEN
  RAISE EXCEPTION 'completed AI remained in positive queue';
 END IF;
END $$;

-- A step event owned by another animal but pointing at active's assignment is ignored.
UPDATE event_protocol_step SET assignment_event_id=(SELECT assignment_id FROM ovsynch_fixture WHERE label='active')
WHERE event_id=(SELECT step_id FROM ovsynch_fixture WHERE label='other-animal');
DO $$ DECLARE v jsonb; BEGIN
 SELECT field_value_at((SELECT animal_id FROM ovsynch_fixture WHERE label='other-animal'),'CURRENT_OVSYNCH_GNRH1_DATE','2026-09-04 12:00-03'::timestamptz,'2026-09-04 12:00-03'::timestamptz) INTO v;
 IF v IS NOT NULL AND v <> 'null'::jsonb THEN RAISE EXCEPTION 'cross-animal step leaked: %',v; END IF;
END $$;

-- Completion and cancellation remove their assignments from the effective set.
INSERT INTO animal_event(id,farm_id,animal_id,event_type_id,occurred_at,recorded_at,source_type,source_record_id)
SELECT md5('assignment-boundary:'||f.label||':close')::uuid,i.farm_id,f.animal_id,
       CASE WHEN f.label='completed' THEN i.completed_type ELSE i.cancelled_type END,
       '2026-09-04 11:00-03','2026-09-04 12:00-03','SIMULATION','fixture:'||f.label||':close'
FROM ovsynch_fixture f CROSS JOIN ovsynch_ids i WHERE f.label IN ('completed','cancelled');
INSERT INTO event_protocol_completion(event_id,farm_id,assignment_event_id)
SELECT md5('assignment-boundary:completed:close')::uuid,i.farm_id,f.assignment_id
FROM ovsynch_fixture f CROSS JOIN ovsynch_ids i WHERE f.label='completed';
INSERT INTO event_protocol_cancellation(event_id,farm_id,assignment_event_id,reason)
SELECT md5('assignment-boundary:cancelled:close')::uuid,i.farm_id,f.assignment_id,'fixture'
FROM ovsynch_fixture f CROSS JOIN ovsynch_ids i WHERE f.label='cancelled';

-- A superseding assignment replaces the old one and has no completed step.
INSERT INTO animal_event(id,farm_id,animal_id,event_type_id,occurred_at,recorded_at,source_type,source_record_id,supersedes_event_id)
SELECT md5('assignment-boundary:superseded:replacement')::uuid,i.farm_id,f.animal_id,i.assigned_type,'2026-09-03 09:00-03','2026-09-03 10:00-03','SIMULATION','fixture:superseded:replacement',f.assignment_id
FROM ovsynch_fixture f CROSS JOIN ovsynch_ids i WHERE f.label='superseded';
INSERT INTO event_protocol_assignment(event_id,farm_id,protocol_id,purpose)
SELECT md5('assignment-boundary:superseded:replacement')::uuid,i.farm_id,i.protocol_id,'fixture'
FROM ovsynch_fixture f CROSS JOIN ovsynch_ids i WHERE f.label='superseded';

-- Voiding is the supported correction path for the original assignment.
UPDATE animal_event SET voided_at='2026-09-04 11:00-03'
WHERE id=(SELECT assignment_id FROM ovsynch_fixture WHERE label='voided');

DO $$ DECLARE f record; v jsonb; BEGIN
 FOR f IN SELECT * FROM ovsynch_fixture WHERE label<>'active' LOOP
  SELECT field_value_at(f.animal_id,'CURRENT_OVSYNCH_GNRH1_DATE','2026-09-04 12:00-03'::timestamptz,'2026-09-04 12:00-03'::timestamptz) INTO v;
  IF v IS NOT NULL AND v <> 'null'::jsonb THEN RAISE EXCEPTION 'closed/corrected assignment leaked for %: %',f.label,v; END IF;
 END LOOP;
END $$;

ROLLBACK;
