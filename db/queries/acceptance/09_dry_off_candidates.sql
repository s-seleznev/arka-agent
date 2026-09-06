DO $$ DECLARE n integer; BEGIN
  SELECT count(*) INTO n FROM animal_state_at('2026-08-31 23:59:59Z')
  WHERE is_pregnant AND pregnancy_days >= 220 AND expected_dry_off_date <= '2026-10-01';
  IF n <> 8 THEN RAISE EXCEPTION 'dry-off candidates: expected 8, got %', n; END IF;
END $$;
