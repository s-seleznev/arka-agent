DO $$ DECLARE n integer; BEGIN
  SELECT count(*) INTO n FROM animal_state_at('2026-08-31 23:59:59Z')
  WHERE status_code='CULLED' AND is_exited AND days_in_milk < 60;
  IF n <> 8 THEN RAISE EXCEPTION 'culled before 60 DIM: expected 8, got %', n; END IF;
END $$;
