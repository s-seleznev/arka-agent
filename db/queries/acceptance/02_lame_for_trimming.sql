DO $$ DECLARE n integer; BEGIN
  SELECT count(*) INTO n
  FROM effective_animal_events('2026-08-31 23:59:59Z', '2026-08-31 23:59:59Z') e
  JOIN event_diagnosis d ON (d.event_id,d.farm_id)=(e.id,e.farm_id)
  JOIN disease_definition dd ON dd.id=d.disease_id
  WHERE dd.code='LAMENESS' AND NOT EXISTS (
    SELECT 1 FROM effective_animal_events('2026-08-31 23:59:59Z','2026-08-31 23:59:59Z') r
    JOIN event_diagnosis_resolution dr ON (dr.event_id,dr.farm_id)=(r.id,r.farm_id)
    WHERE dr.diagnosis_event_id=e.id);
  IF n <> 8 THEN RAISE EXCEPTION 'lame: expected 8, got %', n; END IF;
END $$;
