DO $$ DECLARE n integer; BEGIN
  SELECT count(*) INTO n FROM animal_state_at('2026-08-31 23:59:59Z')
  WHERE status_code='FRESH' AND days_in_milk <= 21;
  IF n <> 8 THEN RAISE EXCEPTION 'fresh cows: expected 8, got %', n; END IF;
END $$;
