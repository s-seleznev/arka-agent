-- GENERATED TEST DATA: deterministic additive fixtures. Source methodology unknown.
CREATE TEMP TABLE rule_fixture_animals ON COMMIT DROP AS
SELECT * FROM (SELECT a.id AS animal_id,a.farm_id,a.birth_date,f.timezone,
 row_number() OVER(PARTITION BY a.farm_id ORDER BY a.id) AS ordinal,
 (:'fixture_date'::date+time '12:00') AT TIME ZONE f.timezone AS fixture_at
 FROM animal a JOIN farm f ON f.id=a.farm_id WHERE NOT EXISTS(SELECT 1 FROM animal_event ee JOIN event_exit ex ON ex.event_id=ee.id AND ex.farm_id=ee.farm_id WHERE ee.animal_id=a.id) AND a.birth_date<:'fixture_date'::date-400) selected WHERE ordinal<=12;
INSERT INTO protocol_definition(id,code,name,category,version,valid_from)
VALUES(md5('rules-fixture:presynch')::uuid,'PRESYNCH','Пресинхронизация: тестовое назначение','REPRODUCTION',1,'2020-01-01Z') ON CONFLICT DO NOTHING;
INSERT INTO animal_event(id,farm_id,animal_id,event_type_id,occurred_at,recorded_at,source_type,source_record_id,comment,metadata)
SELECT md5('rules-fixture:'||kind||':'||animal_id)::uuid,farm_id,animal_id,md5('event-type:'||event_code)::uuid,
 CASE WHEN kind IN('assign','start') THEN fixture_at-(35+ordinal%3)*interval '1 day' ELSE fixture_at END,
 fixture_at,'SIMULATION','rules-fixture:'||kind||':'||animal_id,'GENERATED TEST DATA',
 jsonb_build_object('generator','rules-fixture-v1','referenceDate',:'fixture_date','seed',42,'sourceFormulaRestored',false)
FROM rule_fixture_animals CROSS JOIN (VALUES('assign','PROTOCOL_ASSIGNED'),('start','PROTOCOL_STARTED'),('genomic','EXTERNAL_ASSESSMENT')) kinds(kind,event_code)
WHERE ordinal<=9 ON CONFLICT DO NOTHING;
INSERT INTO event_protocol_assignment(event_id,farm_id,protocol_id,purpose,planned_start_at)
SELECT md5('rules-fixture:assign:'||animal_id)::uuid,farm_id,md5('rules-fixture:presynch')::uuid,'GENERATED TEST DATA',fixture_at-(35+ordinal%3)*interval '1 day' FROM rule_fixture_animals WHERE ordinal<=9 ON CONFLICT DO NOTHING;
INSERT INTO event_protocol_start(event_id,farm_id,assignment_event_id,actual_start_at,day_origin,provenance)
SELECT md5('rules-fixture:start:'||animal_id)::uuid,farm_id,md5('rules-fixture:assign:'||animal_id)::uuid,fixture_at-(35+ordinal%3)*interval '1 day',0,'GENERATED TEST DATA; day 0 is a declared test assumption, source day origin unresolved' FROM rule_fixture_animals WHERE ordinal<=9 ON CONFLICT DO NOTHING;
INSERT INTO event_external_assessment(event_id,farm_id,assessment_kind,assessed_on,comment,methodology,provenance)
SELECT md5('rules-fixture:genomic:'||animal_id)::uuid,farm_id,'GENOMIC',:'fixture_date'::date,'Тестовая геномная оценка','EXTERNAL_INPUT_METHOD_UNKNOWN','GENERATED TEST DATA; simulated imported result, no genomic algorithm claimed' FROM rule_fixture_animals WHERE ordinal<=9 ON CONFLICT DO NOTHING;
CREATE TEMP TABLE rule_fixture_lactations ON COMMIT DROP AS
SELECT fixture.*,c.id AS calving_id FROM rule_fixture_animals fixture
JOIN LATERAL(SELECT e.id FROM effective_animal_events(fixture.fixture_at,fixture.fixture_at) e WHERE e.animal_id=fixture.animal_id AND event_code='CALVED' ORDER BY occurred_at DESC,recorded_at DESC,id DESC LIMIT 1)c ON true;
INSERT INTO animal_event(id,farm_id,animal_id,event_type_id,occurred_at,recorded_at,source_type,source_record_id,comment,metadata)
SELECT md5('rules-fixture:forecast:'||animal_id)::uuid,farm_id,animal_id,md5('event-type:EXTERNAL_ASSESSMENT')::uuid,fixture_at,fixture_at,'SIMULATION','rules-fixture:forecast:'||animal_id,'GENERATED TEST DATA','{"methodologyRestored":false,"generator":"rules-fixture-v1","seed":42}' FROM rule_fixture_lactations WHERE ordinal<=9 ON CONFLICT DO NOTHING;
INSERT INTO event_external_assessment(event_id,farm_id,assessment_kind,assessed_on,value_numeric,lactation_event_id,methodology,provenance)
SELECT md5('rules-fixture:forecast:'||animal_id)::uuid,farm_id,'MILK_305_FORECAST',:'fixture_date'::date,
 (ARRAY[5000,5000.5,5001,6000,6000.5,6001,12000,12000.5,12001]::numeric[])[ordinal],calving_id,
 'EXTERNAL_INPUT_METHOD_UNKNOWN','GENERATED TEST DATA; boundary fixture, not calculated milk forecast'
FROM rule_fixture_lactations WHERE ordinal<=9 ON CONFLICT DO NOTHING;
SELECT count(*) AS fixture_animals FROM rule_fixture_animals;
