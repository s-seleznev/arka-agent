-- Append corrections for the initial l8 fixture; never modify event history.
-- Run with psql -v ON_ERROR_STOP=1 -1 -f this-file.
CREATE TEMP TABLE l8_birth_corrections ON COMMIT DROP AS
SELECT e.id old_id, md5(e.id::text || ':birth-correction')::uuid new_id,
       a.birth_date::timestamptz + interval '3 days 12 hours' corrected_at
FROM animal_event e JOIN animal a ON a.id=e.animal_id AND a.farm_id=e.farm_id
WHERE e.farm_id='2911f095-dd8c-5878-a8f3-2e027513ad6a'::uuid
AND e.source_record_id LIKE 'l8-%-group' AND e.occurred_at<a.birth_date::timestamptz;
INSERT INTO animal_event(id,farm_id,animal_id,event_type_id,occurred_at,recorded_at,source_type,source_record_id,actor_ref,supersedes_event_id,comment,metadata)
SELECT c.new_id,e.farm_id,e.animal_id,e.event_type_id,c.corrected_at,clock_timestamp(),
 e.source_type,e.source_record_id||'-birth-correction','l8-fixture-repair',e.id,'Correct synthetic group event before birth',e.metadata
FROM l8_birth_corrections c JOIN animal_event e ON e.id=c.old_id
ON CONFLICT(id) DO NOTHING;
INSERT INTO event_group_change(event_id,farm_id,previous_group_id,new_group_id,reason)
SELECT c.new_id,g.farm_id,g.previous_group_id,g.new_group_id,'Correct synthetic event chronology'
FROM l8_birth_corrections c JOIN event_group_change g ON g.event_id=c.old_id
ON CONFLICT DO NOTHING;
