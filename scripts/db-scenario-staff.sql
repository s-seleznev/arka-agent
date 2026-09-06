BEGIN;
CREATE TEMP TABLE report_staff ON COMMIT DROP AS
SELECT DISTINCT s.animal_id,s.farm_id,CASE WHEN s.status_code='READY_FOR_INSEMINATION' THEN 'Петров · Осеменатор' ELSE 'Сидорова · Ветврач' END subject,
md5('demo-report-staff:'||s.animal_id)::uuid event_id
FROM animal_state_query s WHERE s.farm_id='2911f095-dd8c-5878-a8f3-2e027513ad6a' AND s.active_protocol_count>0;
INSERT INTO animal_event(id,farm_id,animal_id,event_type_id,occurred_at,recorded_at,source_type,source_record_id,comment)
SELECT s.event_id,s.farm_id,s.animal_id,t.id,now(),now(),'SIMULATION','demo-report-staff:'||s.animal_id,'Demo responsible assignment'
FROM report_staff s CROSS JOIN event_type t WHERE t.farm_id IS NULL AND t.code='STAFF_ASSIGNMENT_CHANGED' ON CONFLICT DO NOTHING;
INSERT INTO event_staff_assignment(event_id,farm_id,subject_id,assignment_role,action)
SELECT event_id,farm_id,subject,'PROTOCOL_CONTROL','ASSIGNED' FROM report_staff ON CONFLICT DO NOTHING;
COMMIT;
