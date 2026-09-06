DO $$ DECLARE n integer; BEGIN
  SELECT count(*) INTO n FROM animal_state_at('2026-08-31 23:59:59Z')
  WHERE status_code='INSEMINATED' AND last_insemination_at IS NOT NULL AND NOT is_pregnant;
  IF n <> 8 THEN RAISE EXCEPTION 'inseminated cows: expected 8, got %', n; END IF;
END $$;
