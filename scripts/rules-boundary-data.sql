-- GENERATED TEST DATA, seed 42. Additive lifecycle and ordinal-event fixtures.
-- First event anchors make cohort selection stable after status and exit changes.
CREATE TEMP TABLE rule_boundary_cohort ON COMMIT DROP AS
WITH existing AS (
 SELECT e.farm_id,e.animal_id,(e.metadata->>'fixtureOrdinal')::integer AS ordinal,
 e.metadata->>'fixtureKind' AS kind
 FROM animal_event e WHERE e.source_record_id LIKE 'rules-boundary-v1:anchor:%'
), candidates AS (
 SELECT s.farm_id,s.animal_id,row_number() OVER(PARTITION BY s.farm_id ORDER BY s.animal_id)::integer AS ordinal,'insemination'::text AS kind
 FROM animal_state_query s
 WHERE NOT s.is_exited AND NOT s.is_archived AND s.status_code='LACTATING' AND s.days_in_milk>=120
 AND s.last_insemination_at IS NULL AND NOT EXISTS(SELECT 1 FROM existing e WHERE e.farm_id=s.farm_id AND e.kind='insemination')
 AND NOT EXISTS(SELECT 1 FROM animal_event e WHERE e.animal_id=s.animal_id AND e.source_record_id LIKE 'rules-fixture:%')
 UNION ALL
 SELECT s.farm_id,s.animal_id,row_number() OVER(PARTITION BY s.farm_id ORDER BY s.animal_id)::integer,'exit'
 FROM animal_state_query s
 WHERE NOT s.is_exited AND NOT s.is_archived AND s.status_code='SELL_READY'
 AND NOT EXISTS(SELECT 1 FROM existing e WHERE e.farm_id=s.farm_id AND e.kind='exit')
 AND NOT EXISTS(SELECT 1 FROM animal_event e WHERE e.animal_id=s.animal_id AND e.source_record_id LIKE 'rules-fixture:%')
), cohort AS (SELECT * FROM existing UNION ALL SELECT * FROM candidates WHERE ordinal<=2)
SELECT c.*,f.timezone,(:'fixture_date'::date+time '12:00') AT TIME ZONE f.timezone AS fixture_at
FROM cohort c JOIN farm f ON f.id=c.farm_id;
DO $$ BEGIN
 IF (SELECT count(*) FROM rule_boundary_cohort)<>24 THEN RAISE EXCEPTION 'expected 24 boundary animals'; END IF;
 IF EXISTS(SELECT 1 FROM rule_boundary_cohort GROUP BY farm_id,kind HAVING count(*)<>2) THEN RAISE EXCEPTION 'each farm must have both boundary cohorts'; END IF;
END $$;
CREATE TEMP TABLE rule_boundary_events ON COMMIT DROP AS
SELECT c.*,n AS insemination_ordinal,
 'INSEMINATED'::text AS event_code,
 ((:'fixture_date'::date-21*(c.ordinal+1-n))+time '12:00') AT TIME ZONE c.timezone AS occurred_at,
 CASE WHEN n=1 THEN 'rules-boundary-v1:anchor:insemination:'||c.farm_id||':'||c.ordinal
 ELSE 'rules-boundary-v1:insemination:'||c.farm_id||':'||c.ordinal||':'||n END AS source_record
FROM rule_boundary_cohort c CROSS JOIN LATERAL generate_series(1,c.ordinal+1)n WHERE kind='insemination'
UNION ALL
SELECT c.*,NULL,'STATUS_CHANGED',fixture_at+interval '1 minute','rules-boundary-v1:status:'||farm_id||':'||ordinal FROM rule_boundary_cohort c WHERE kind='insemination'
UNION ALL
SELECT c.*,NULL,'IDENTIFIER_CHANGED',fixture_at-interval '1 minute','rules-boundary-v1:ear-tag:'||kind||':'||farm_id||':'||ordinal FROM rule_boundary_cohort c
UNION ALL
SELECT c.*,NULL,'EXITED',fixture_at+interval '2 minutes','rules-boundary-v1:anchor:exit:'||farm_id||':'||ordinal FROM rule_boundary_cohort c WHERE kind='exit';
INSERT INTO animal_event(id,farm_id,animal_id,event_type_id,occurred_at,recorded_at,source_type,source_record_id,comment,metadata)
SELECT md5(source_record)::uuid,farm_id,animal_id,md5('event-type:'||event_code)::uuid,occurred_at,
 fixture_at+interval '3 minutes','SIMULATION',source_record,'GENERATED TEST DATA',
 jsonb_build_object('generator','rules-boundary-v1','seed',42,'fixtureKind',kind,'fixtureOrdinal',ordinal,'referenceDate',:'fixture_date','provenance','Synthetic lifecycle and ordinal-event acceptance fixture')
FROM rule_boundary_events ON CONFLICT DO NOTHING;
INSERT INTO event_insemination(event_id,farm_id,bull_ref,semen_batch,dose,method,technician_ref)
SELECT md5(source_record)::uuid,farm_id,'SIMULATED-BULL-42','SIMULATED-BATCH-42',1,'ARTIFICIAL','SIMULATED-TECHNICIAN'
FROM rule_boundary_events WHERE event_code='INSEMINATED' ON CONFLICT DO NOTHING;
INSERT INTO event_status_change(event_id,farm_id,previous_status_id,new_status_id,reason)
SELECT md5(source_record)::uuid,farm_id,md5('status:LACTATING')::uuid,md5('status:INSEMINATED')::uuid,'GENERATED TEST DATA; status after final fixture insemination'
FROM rule_boundary_events WHERE event_code='STATUS_CHANGED' ON CONFLICT DO NOTHING;
INSERT INTO event_identifier_change(event_id,farm_id,identifier_type,identifier_value,action,is_primary)
SELECT md5(source_record)::uuid,farm_id,'EAR_TAG','TEST-EAR-'||left(farm_id::text,8)||'-'||kind||'-'||ordinal,'ASSIGNED',false
FROM rule_boundary_events WHERE event_code='IDENTIFIER_CHANGED' ON CONFLICT DO NOTHING;
INSERT INTO event_exit(event_id,farm_id,exit_type,reason,counterparty)
SELECT md5(source_record)::uuid,farm_id,CASE ordinal WHEN 1 THEN 'SOLD' ELSE 'DIED' END,
 'GENERATED TEST DATA; lifecycle boundary example',CASE ordinal WHEN 1 THEN 'SIMULATED BUYER' ELSE NULL END
FROM rule_boundary_events WHERE event_code='EXITED' ON CONFLICT DO NOTHING;
SET CONSTRAINTS ALL IMMEDIATE;
-- Independent expectations derive from fixture timetable, not interpreter output.
DO $$ DECLARE bad_count integer; BEGIN
 SELECT count(*) INTO bad_count FROM rule_boundary_cohort c WHERE c.kind='insemination' AND (
  (SELECT count(*) FROM animal_event e JOIN event_type et ON et.id=e.event_type_id
   WHERE e.animal_id=c.animal_id AND et.code='INSEMINATED'
    AND e.occurred_at>=(SELECT max(calved.occurred_at) FROM animal_event calved JOIN event_type cet ON cet.id=calved.event_type_id WHERE calved.animal_id=c.animal_id AND cet.code='CALVED'))<>c.ordinal+1);
 IF bad_count<>0 THEN RAISE EXCEPTION 'unexpected current lactation insemination history'; END IF;
 IF EXISTS(SELECT 1 FROM rule_boundary_events b JOIN animal_event e ON e.animal_id=b.animal_id
 WHERE b.event_code='EXITED' AND e.occurred_at>b.occurred_at) THEN RAISE EXCEPTION 'exit must close history'; END IF;
END $$;
