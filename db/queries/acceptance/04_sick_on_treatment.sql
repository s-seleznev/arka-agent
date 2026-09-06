DO $$ DECLARE n integer; BEGIN
  SELECT count(DISTINCT s.animal_id) INTO n
  FROM animal_state_at('2026-08-31 23:59:59Z') s
  JOIN effective_animal_events('2026-08-31 23:59:59Z','2026-08-31 23:59:59Z') e ON e.animal_id=s.animal_id
  WHERE s.active_diagnosis_count > 0 AND e.event_code='TREATMENT_GIVEN';
  IF n <> 8 THEN RAISE EXCEPTION 'sick on treatment: expected 8, got %', n; END IF;
END $$;
