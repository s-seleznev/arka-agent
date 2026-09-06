DO $$
DECLARE
  farm_one uuid;
  farm_two uuid;
  animal_one uuid;
  event_id uuid := '00000000-0000-0000-0000-000000000001';
BEGIN
  SELECT id INTO farm_one FROM farm ORDER BY id LIMIT 1;
  SELECT id INTO farm_two FROM farm WHERE id <> farm_one ORDER BY id LIMIT 1;
  SELECT id INTO animal_one FROM animal WHERE farm_id = farm_one LIMIT 1;

  BEGIN
    INSERT INTO animal_event(
      id,farm_id,animal_id,event_type_id,occurred_at,recorded_at,source_type
    ) VALUES (
      event_id,farm_two,animal_one,
      (SELECT id FROM event_type WHERE code='NOTE_CHANGED' AND farm_id IS NULL),
      '2026-08-01Z','2026-08-01Z','SIMULATION'
    );
    RAISE EXCEPTION 'cross-farm event was accepted';
  EXCEPTION WHEN foreign_key_violation OR raise_exception THEN
    IF SQLERRM = 'cross-farm event was accepted' THEN RAISE; END IF;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO calculated_field_dependency(calculated_field_id,depends_on_field_id)
    VALUES (
      md5('calculated-field:EXPECTED_CALVING_DATE:1')::uuid,
      md5('field:EXPECTED_DRY_OFF_DATE')::uuid
    );
    RAISE EXCEPTION 'formula dependency cycle was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'formula dependency cycle was accepted' THEN RAISE; END IF;
  END;
END;
$$;

DO $$
DECLARE target_event uuid;
BEGIN
  SELECT id INTO target_event FROM animal_event ORDER BY id LIMIT 1;
  BEGIN
    UPDATE animal_event SET comment='tampered' WHERE id=target_event;
    RAISE EXCEPTION 'event mutation was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'event mutation was accepted' THEN RAISE; END IF;
  END;
END;
$$;

DO $$
DECLARE
  farm_one uuid;
  animal_one uuid;
  event_id uuid := '00000000-0000-0000-0000-000000000002';
BEGIN
  SELECT id INTO farm_one FROM farm ORDER BY id LIMIT 1;
  SELECT id INTO animal_one FROM animal WHERE farm_id = farm_one LIMIT 1;
  BEGIN
    INSERT INTO animal_event(
      id,farm_id,animal_id,event_type_id,occurred_at,recorded_at,source_type
    ) VALUES (
      event_id,farm_one,animal_one,
      (SELECT id FROM event_type WHERE code='NOTE_CHANGED' AND farm_id IS NULL),
      '2026-08-01Z','2026-08-01Z','SIMULATION'
    );
    INSERT INTO event_measurement(event_id,farm_id,measurement_code,value_numeric,unit_code)
    VALUES (event_id,farm_one,'WEIGHT',500,'KG');
    RAISE EXCEPTION 'wrong detail table was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'wrong detail table was accepted' THEN RAISE; END IF;
  END;
END;
$$;

DO $$
DECLARE
  farm_one uuid;
  animal_one uuid;
  field_id uuid;
  event_id uuid := '00000000-0000-0000-0000-000000000003';
BEGIN
  SELECT id INTO farm_one FROM farm ORDER BY id LIMIT 1;
  SELECT id INTO animal_one FROM animal WHERE farm_id = farm_one LIMIT 1;
  SELECT id INTO field_id FROM field_definition WHERE farm_id=farm_one LIMIT 1;
  BEGIN
    INSERT INTO animal_event(
      id,farm_id,animal_id,event_type_id,occurred_at,recorded_at,source_type
    ) VALUES (
      event_id,farm_one,animal_one,
      (SELECT id FROM event_type WHERE code='CUSTOM_EVENT_RECORDED' AND farm_id IS NULL),
      '2026-08-01Z','2026-08-01Z','SIMULATION'
    );
    INSERT INTO custom_event_value(event_id,farm_id,field_definition_id,value_text)
    VALUES (event_id,farm_one,field_id,'not a number');
    RAISE EXCEPTION 'wrong custom value type was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'wrong custom value type was accepted' THEN RAISE; END IF;
  END;
END;
$$;
