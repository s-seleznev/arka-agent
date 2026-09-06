DO $$ DECLARE n integer; BEGIN
  SELECT count(*) INTO n FROM animal_state_at('2026-08-31 23:59:59Z')
  WHERE status_code='READY_FOR_INSEMINATION' AND sex='FEMALE';
  IF n <> 8 THEN RAISE EXCEPTION 'ready for insemination: expected 8, got %', n; END IF;
END $$;
