DO $$
DECLARE
  actual integer;
BEGIN
  SELECT count(*) INTO actual FROM farm;
  IF actual <> 2 THEN RAISE EXCEPTION 'expected 2 farms, got %', actual; END IF;

  SELECT count(*) INTO actual FROM animal;
  IF actual <> 80 THEN RAISE EXCEPTION 'expected 80 animals, got %', actual; END IF;

  SELECT count(*) INTO actual FROM animal_event ae
  JOIN animal a ON a.id = ae.animal_id
  WHERE ae.occurred_at::date < a.birth_date;
  IF actual <> 0 THEN RAISE EXCEPTION '% events occur before birth', actual; END IF;

  SELECT count(*) INTO actual FROM animal_event ae
  JOIN event_type et ON et.id = ae.event_type_id
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_class c WHERE c.relname = et.detail_table
  );
  IF actual <> 0 THEN RAISE EXCEPTION '% events reference missing detail tables', actual; END IF;

  SELECT count(*) INTO actual FROM event_type et
  WHERE et.is_active AND NOT EXISTS (
    SELECT 1 FROM animal_event ae WHERE ae.event_type_id=et.id
  );
  IF actual <> 0 THEN RAISE EXCEPTION '% active event types lack generated examples', actual; END IF;

  IF EXISTS (
    SELECT 1 FROM animal_state_at('2026-08-31 23:59:59Z', '2026-08-31 23:59:59Z')
    WHERE primary_identifier IS NULL OR status_code IS NULL OR group_code IS NULL
  ) THEN RAISE EXCEPTION 'state contains missing identifier, status, or group'; END IF;
END;
$$;

DO $$
DECLARE
  target uuid;
  result jsonb;
BEGIN
  SELECT animal_id INTO target
  FROM animal_state_at('2026-08-31 23:59:59Z','2026-08-31 23:59:59Z')
  WHERE status_code='READY_FOR_INSEMINATION' ORDER BY animal_id LIMIT 1;

  result := evaluate_formula_ast(target,
    '{"op":"AVG","event":"DAILY_MILK_RECORDED","value":"MILK_KG","from":"2026-08-01Z"}',
    '2026-08-31 23:59:59Z','2026-08-31 23:59:59Z');
  IF result <> '26.5'::jsonb THEN RAISE EXCEPTION 'AVG formula failed: %', result; END IF;

  result := evaluate_formula_ast(target,
    '{"op":"LAG","event":"DAILY_MILK_RECORDED","value":"MILK_KG","from":"2026-08-01Z"}',
    '2026-08-31 23:59:59Z','2026-08-31 23:59:59Z');
  IF result <> '25'::jsonb THEN RAISE EXCEPTION 'LAG formula failed: %', result; END IF;

  result := evaluate_formula_ast(target,
    '{"op":"IF","condition":{"op":"GT","left":{"op":"FIELD","code":"AGE_DAYS"},"right":{"op":"LITERAL","value":365}},"then":{"op":"LITERAL","value":"adult"},"else":{"op":"LITERAL","value":"young"}}',
    '2026-08-31 23:59:59Z','2026-08-31 23:59:59Z');
  IF result <> '"adult"'::jsonb THEN RAISE EXCEPTION 'IF formula failed: %', result; END IF;
END;
$$;

DO $$
DECLARE
  target uuid;
  before_value jsonb;
  after_value jsonb;
BEGIN
  SELECT animal_id INTO target
  FROM animal_state_at('2026-08-31 23:59:59Z', '2026-08-31 23:59:59Z')
  WHERE status_code = 'READY_FOR_INSEMINATION' ORDER BY animal_id LIMIT 1;

  before_value := field_value_at(target, 'LAST_WEIGHT_KG', '2026-08-31 23:59:59Z', '2026-08-16 23:59:59Z');
  after_value := field_value_at(target, 'LAST_WEIGHT_KG', '2026-08-31 23:59:59Z', '2026-08-31 23:59:59Z');
  IF before_value <> '500'::jsonb OR after_value <> '525'::jsonb THEN
    RAISE EXCEPTION 'point-in-time correction failed: before %, after %', before_value, after_value;
  END IF;
END;
$$;
