-- Fill the previous farm-local day for the bounded adult demo cohort, idempotently.
BEGIN;
CREATE TEMP TABLE scenario_milk ON COMMIT DROP AS
SELECT s.animal_id,s.farm_id,(now() AT TIME ZONE f.timezone)::date-1 farm_date,
 (((now() AT TIME ZONE f.timezone)::date-1)+time '20:00') AT TIME ZONE f.timezone occurred_at,
 CASE WHEN s.pregnancy_days>=213 THEN 12+(s.lactation_number%4)*1.2
 WHEN s.days_in_milk<=14 THEN 18+s.days_in_milk*0.65+s.lactation_number
 ELSE 26+s.lactation_number*1.4 END milk,
 md5('scenario-milk:'||s.animal_id||':'||((now() AT TIME ZONE f.timezone)::date-1))::uuid event_id
FROM animal_state_query s JOIN farm f ON f.id=s.farm_id
WHERE s.farm_id='2911f095-dd8c-5878-a8f3-2e027513ad6a' AND s.lactation_number>0 AND NOT s.is_exited AND s.status_code<>'DRY';
INSERT INTO animal_event(id,farm_id,animal_id,event_type_id,occurred_at,recorded_at,source_type,source_record_id,comment)
SELECT x.event_id,x.farm_id,x.animal_id,t.id,x.occurred_at,x.occurred_at+interval '1 hour','SIMULATION','scenario-milk:'||x.animal_id||':'||x.farm_date,'Synthetic daily yield'
FROM scenario_milk x CROSS JOIN event_type t WHERE t.code='DAILY_MILK_RECORDED' AND t.farm_id IS NULL ON CONFLICT DO NOTHING;
INSERT INTO event_daily_milk(event_id,farm_id,farm_date,milk_kg,milking_count)
SELECT event_id,farm_id,farm_date,milk,3 FROM scenario_milk ON CONFLICT DO NOTHING;
SELECT refresh_animal_state_query();
COMMIT;
