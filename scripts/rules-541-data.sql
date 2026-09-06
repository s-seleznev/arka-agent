-- GENERATED TEST DATA. Explicit run timestamp; one reproducible cohort per farm date.
CREATE TEMP TABLE rule_541_cohort ON COMMIT DROP AS
WITH target AS (SELECT id,timezone,(:'fixture_as_of'::timestamptz AT TIME ZONE timezone)::date AS fixture_date FROM farm WHERE id='5addf364-4bff-5189-ac00-4eace4643d72'),
existing AS (
 SELECT e.animal_id,e.farm_id,(e.metadata->>'fixtureSlot')::integer AS slot
 FROM animal_event e JOIN target t ON t.id=e.farm_id
 WHERE e.metadata->>'generator'='rules-541-v1' AND e.metadata->>'referenceDate'=t.fixture_date::text AND e.source_record_id LIKE '%:anchor'
), candidates AS (
 SELECT s.animal_id,s.farm_id,row_number() OVER(ORDER BY s.animal_id)::integer AS slot
 FROM animal_state_query s JOIN target t ON t.id=s.farm_id
 WHERE NOT s.is_exited AND NOT s.is_archived AND s.status_code='LACTATING' AND s.days_in_milk>=120
 AND s.last_insemination_at IS NULL AND NOT EXISTS(SELECT 1 FROM existing)
 AND NOT EXISTS(SELECT 1 FROM animal_event e WHERE e.animal_id=s.animal_id AND e.source_record_id LIKE 'rules-%')
), selected AS(SELECT * FROM existing UNION ALL SELECT * FROM candidates WHERE slot<=10)
SELECT s.*,t.timezone,t.fixture_date,:'fixture_as_of'::timestamptz AS fixture_at,
 CASE WHEN slot<=5 THEN 'presynch' ELSE 'insemination' END AS branch,
 (ARRAY[36,36,35,37,36,42,48,41,49,45])[slot] AS days,
 CASE WHEN slot IN(5,10) THEN 'LACTATING' ELSE 'READY_FOR_INSEMINATION' END AS status,
 slot IN(1,2,6,7) AS expected_match,
 'rules-541-v1:'||t.fixture_date||':'||s.slot AS prefix
FROM selected s JOIN target t ON t.id=s.farm_id;
DO $$ BEGIN IF (SELECT count(*) FROM rule_541_cohort)<>10 THEN RAISE EXCEPTION '541 requires ten eligible fixture animals'; END IF; END $$;
CREATE TEMP TABLE rule_541_events ON COMMIT DROP AS
SELECT c.*,'PROTOCOL_ASSIGNED'::text AS event_code,fixture_at-days*interval '1 day' AS occurred_at,prefix||':anchor' AS source_record FROM rule_541_cohort c WHERE branch='presynch'
UNION ALL SELECT c.*,'PROTOCOL_STARTED',fixture_at-days*interval '1 day',prefix||':start' FROM rule_541_cohort c WHERE branch='presynch'
UNION ALL SELECT c.*,'INSEMINATED',fixture_at-days*interval '1 day',prefix||':anchor' FROM rule_541_cohort c WHERE branch='insemination'
UNION ALL SELECT c.*,'PREGNANCY_CHECKED',fixture_at-interval '1 day',prefix||':negative-check' FROM rule_541_cohort c WHERE branch='insemination'
UNION ALL SELECT c.*,'STATUS_CHANGED',fixture_at-interval '1 second',prefix||':status' FROM rule_541_cohort c;
INSERT INTO animal_event(id,farm_id,animal_id,event_type_id,occurred_at,recorded_at,source_type,source_record_id,comment,metadata)
SELECT md5(source_record)::uuid,farm_id,animal_id,md5('event-type:'||event_code)::uuid,occurred_at,fixture_at,'SIMULATION',source_record,'GENERATED TEST DATA',
 jsonb_build_object('generator','rules-541-v1','referenceDate',fixture_date,'fixtureAsOf',fixture_at,'fixtureSlot',slot,'branch',branch,'expectedDays',days,'expectedMatch',expected_match,'provenance','Source 20/541 boundary test; PRESYNCH day origin zero is a declared demo assumption')
FROM rule_541_events ON CONFLICT DO NOTHING;
INSERT INTO event_protocol_assignment(event_id,farm_id,protocol_id,purpose,planned_start_at)
SELECT md5(source_record)::uuid,farm_id,md5('rules-fixture:presynch')::uuid,'GENERATED TEST DATA; source 20/541 branch',occurred_at FROM rule_541_events WHERE event_code='PROTOCOL_ASSIGNED' ON CONFLICT DO NOTHING;
INSERT INTO event_protocol_start(event_id,farm_id,assignment_event_id,actual_start_at,day_origin,provenance)
SELECT md5(source_record)::uuid,farm_id,md5(prefix||':anchor')::uuid,occurred_at,0,'GENERATED TEST DATA; explicit zero-based demo day origin'
FROM rule_541_events WHERE event_code='PROTOCOL_STARTED' ON CONFLICT DO NOTHING;
INSERT INTO event_insemination(event_id,farm_id,bull_ref,semen_batch,dose,method,technician_ref)
SELECT md5(source_record)::uuid,farm_id,'SIMULATED-BULL-541','SIMULATED-BATCH-541',1,'ARTIFICIAL','SIMULATED-TECHNICIAN'
FROM rule_541_events WHERE event_code='INSEMINATED' ON CONFLICT DO NOTHING;
INSERT INTO event_pregnancy_check(event_id,farm_id,insemination_event_id,method,result)
SELECT md5(source_record)::uuid,farm_id,md5(prefix||':anchor')::uuid,'ULTRASOUND','NOT_PREGNANT'
FROM rule_541_events WHERE event_code='PREGNANCY_CHECKED' ON CONFLICT DO NOTHING;
INSERT INTO event_status_change(event_id,farm_id,previous_status_id,new_status_id,reason)
SELECT md5(source_record)::uuid,farm_id,md5('status:LACTATING')::uuid,md5('status:'||status)::uuid,'GENERATED TEST DATA; source 20/541 status boundary'
FROM rule_541_events WHERE event_code='STATUS_CHANGED' ON CONFLICT DO NOTHING;
SET CONSTRAINTS ALL IMMEDIATE;
