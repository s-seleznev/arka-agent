-- Demo housing assignment: existing 150 cows, append-only group movements.
BEGIN;
SET LOCAL statement_timeout='180s';
CREATE TEMP TABLE housing_groups(key text, label text, milking boolean) ON COMMIT DROP;
INSERT INTO housing_groups VALUES
 ('fresh','Корпус 1 · Новотельные',true),
 ('milk1','Корпус 1 · Дойные 1',true),
 ('milk2','Корпус 2 · Дойные 2',true),
 ('milk3','Корпус 2 · Дойные 3',true),
 ('dry1','Корпус 3 · Ранний сухостой',false),
 ('dry2','Корпус 3 · Перед отёлом',false);
INSERT INTO farm_group(id,farm_id,code,name,group_type,is_milking,is_lactation_group,valid_from)
SELECT md5('l150-housing:'||key)::uuid,'2911f095-dd8c-5878-a8f3-2e027513ad6a',label,label,'PRODUCTION',milking,true,'2026-09-05 00:00:00Z'
FROM housing_groups ON CONFLICT(id) DO NOTHING;
CREATE TEMP TABLE housing_assignments ON COMMIT DROP AS
SELECT animal_id,group_id previous_group_id,
 md5('l150-housing:'||CASE WHEN status_code='FRESH' THEN 'fresh'
 WHEN status_code='DRY' THEN CASE WHEN pregnancy_days>=250 THEN 'dry2' ELSE 'dry1' END
 WHEN lactation_number=1 THEN 'milk1' WHEN lactation_number=2 THEN 'milk2' ELSE 'milk3' END)::uuid new_group_id,
 md5('l150-housing-event:'||animal_id::text)::uuid event_id
FROM animal_state_query WHERE farm_id='2911f095-dd8c-5878-a8f3-2e027513ad6a';
DO $$ BEGIN IF (SELECT count(*) FROM housing_assignments)<>150 THEN RAISE EXCEPTION 'Expected150 cows'; END IF; END $$;
INSERT INTO animal_event(id,farm_id,animal_id,event_type_id,occurred_at,recorded_at,source_type,source_record_id,actor_ref,comment,metadata)
SELECT h.event_id,'2911f095-dd8c-5878-a8f3-2e027513ad6a',h.animal_id,t.id,clock_timestamp(),clock_timestamp(),'SIMULATION','l150-housing:'||h.animal_id,'l150-housing','Demo housing assignment','{"test_data":true,"fixture":"l150-housing"}'::jsonb
FROM housing_assignments h CROSS JOIN event_type t WHERE t.code='GROUP_CHANGED' AND t.farm_id IS NULL
ON CONFLICT(id) DO NOTHING;
INSERT INTO event_group_change(event_id,farm_id,previous_group_id,new_group_id,reason)
SELECT event_id,'2911f095-dd8c-5878-a8f3-2e027513ad6a',previous_group_id,new_group_id,'Демонстрационное размещение по стадии лактации и сухостоя'
FROM housing_assignments ON CONFLICT DO NOTHING;
SELECT refresh_animal_state_query();
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM animal_state_query s JOIN housing_assignments h USING(animal_id) WHERE s.group_id<>h.new_group_id) THEN RAISE EXCEPTION 'Housing projection mismatch'; END IF;
 IF (SELECT count(DISTINCT group_id) FROM animal_state_query WHERE farm_id='2911f095-dd8c-5878-a8f3-2e027513ad6a' AND status_code='INSEMINATED' AND (rule_values->>'DAYS_SINCE_INSEMINATION')::numeric>=32)<>3 THEN RAISE EXCEPTION 'Expected three UZI groups'; END IF;
END $$;
SELECT group_code,count(*) animals,count(*) FILTER(WHERE status_code='INSEMINATED' AND (rule_values->>'DAYS_SINCE_INSEMINATION')::numeric>=32) first_check
FROM animal_state_query WHERE farm_id='2911f095-dd8c-5878-a8f3-2e027513ad6a' GROUP BY group_code ORDER BY group_code;
COMMIT;
