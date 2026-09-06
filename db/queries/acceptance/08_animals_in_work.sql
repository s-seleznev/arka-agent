DO $$ DECLARE n integer; BEGIN
  SELECT count(*) INTO n FROM animal_state_at('2026-08-31 23:59:59Z')
  WHERE active_protocol_count > 0;
  IF n <> 8 THEN RAISE EXCEPTION 'animals in work: expected 8, got %', n; END IF;
END $$;
