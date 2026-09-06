-- Read-only oracle for the guarded Lactis fixture. It does not mutate data.
-- Run with: psql -v fixture_as_of='2026-09-05' -f scripts/db-lactis-oracle.sql
WITH target AS (
  SELECT '2911f095-dd8c-5878-a8f3-2e027513ad6a'::uuid AS farm_id,
         :'fixture_as_of'::date AS as_of
), ai AS (
  SELECT e.animal_id, e.source_record_id,
         (t.as_of - (e.occurred_at AT TIME ZONE 'UTC')::date) AS days_since_ai
  FROM animal_event e CROSS JOIN target t
  JOIN event_type et ON et.id=e.event_type_id AND et.farm_id IS NULL AND et.code='INSEMINATED'
  WHERE e.farm_id=t.farm_id AND e.source_record_id IN ('l8-f1-a1-insemination','l8-f1-a2-insemination','l8-f1-a3-insemination')
)
SELECT source_record_id, days_since_ai,
       (days_since_ai >= 32) AS uzi1_included,
       (days_since_ai > 39) AS missed_uzi_included
FROM ai ORDER BY source_record_id;

-- Expected result: a1=31/false/false, a2=32/true/false, a3=33/true/false.
SELECT count(*) AS unexpected_other_farms
FROM animal_event e
WHERE e.source_type='SIMULATION' AND e.source_record_id LIKE 'l8-%'
  AND e.farm_id <> '2911f095-dd8c-5878-a8f3-2e027513ad6a'::uuid;
