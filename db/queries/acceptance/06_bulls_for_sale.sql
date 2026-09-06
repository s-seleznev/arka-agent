DO $$ DECLARE n integer; BEGIN
  SELECT count(*) INTO n FROM animal_state_at('2026-08-31 23:59:59Z')
  WHERE sex='MALE' AND status_code='SELL_READY';
  IF n <> 8 THEN RAISE EXCEPTION 'bulls for sale: expected 8, got %', n; END IF;
END $$;
