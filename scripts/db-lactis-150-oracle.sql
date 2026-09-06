-- Run after refreshing the query projection. No data mutations.
DO $$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM animal WHERE farm_id='2911f095-dd8c-5878-a8f3-2e027513ad6a';
 IF n<>150 THEN RAISE EXCEPTION 'expected150, got%',n; END IF;
 SELECT count(*) INTO n FROM animal_state_query WHERE farm_id='2911f095-dd8c-5878-a8f3-2e027513ad6a';
 IF n<>150 THEN RAISE EXCEPTION 'stale projection, got%',n; END IF;
 IF EXISTS (SELECT 1 FROM animal_state_query WHERE farm_id='2911f095-dd8c-5878-a8f3-2e027513ad6a'
 AND (sex<>'FEMALE' OR age_days<730 OR lactation_number NOT BETWEEN 1 AND 5)) THEN RAISE EXCEPTION 'invalid cow demographics'; END IF;
 IF EXISTS (SELECT 1 FROM animal_state_query WHERE farm_id='2911f095-dd8c-5878-a8f3-2e027513ad6a'
 AND last_insemination_at<last_calving_at) THEN RAISE EXCEPTION 'AI before current calving'; END IF;
 IF EXISTS (SELECT 1 FROM animal_event e JOIN animal a ON a.id=e.animal_id WHERE e.farm_id='2911f095-dd8c-5878-a8f3-2e027513ad6a' AND e.occurred_at::date<a.birth_date) THEN RAISE EXCEPTION 'prebirth event'; END IF;
 IF EXISTS (SELECT 1 FROM event_pregnancy_check p JOIN animal_event check_event ON check_event.id=p.event_id
 JOIN animal_event ai ON ai.id=p.insemination_event_id WHERE p.farm_id='2911f095-dd8c-5878-a8f3-2e027513ad6a'
 AND check_event.occurred_at<ai.occurred_at+interval '28 days') THEN RAISE EXCEPTION 'pregnancy check too early for fixture'; END IF;
 IF EXISTS (SELECT 1 FROM event_daily_milk m JOIN animal_event milk ON milk.id=m.event_id
 JOIN animal_event dry ON dry.animal_id=milk.animal_id JOIN event_dry_off d ON d.event_id=dry.id
 WHERE milk.farm_id='2911f095-dd8c-5878-a8f3-2e027513ad6a' AND milk.occurred_at>dry.occurred_at) THEN RAISE EXCEPTION 'milk after dry off'; END IF;
 SELECT count(*) INTO n FROM animal_state_query WHERE farm_id='2911f095-dd8c-5878-a8f3-2e027513ad6a'
 AND status_code='INSEMINATED' AND (rule_values->>'DAYS_SINCE_INSEMINATION')::numeric>=32;
 IF n<>19 THEN RAISE EXCEPTION 'UZI1 expected19, got%',n; END IF;
END $$;
SELECT status_code,count(*),min(lactation_number) min_lactation,max(lactation_number) max_lactation
FROM animal_state_query WHERE farm_id='2911f095-dd8c-5878-a8f3-2e027513ad6a' GROUP BY status_code ORDER BY status_code;
SELECT count(*) total_animals FROM animal;
