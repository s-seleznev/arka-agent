DO $$ DECLARE n integer; BEGIN
  SELECT count(*) INTO n FROM animal_state_at('2026-08-31 23:59:59Z')
  WHERE sex = 'FEMALE' AND status_code = 'HEIFER' AND age_days >= 365;
  IF n <> 8 THEN RAISE EXCEPTION 'heifers 12+: expected 8, got %', n; END IF;
END $$;
