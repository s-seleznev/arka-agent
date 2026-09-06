DO $$ DECLARE c record; matched boolean; branch_counts integer[]; BEGIN
 IF (SELECT count(*) FROM animal)<>51000 OR (SELECT md5(string_agg(id::text,',' ORDER BY id)) FROM animal)<>'0490a84cb40198d2a617aa19a5221b70' THEN RAISE EXCEPTION 'animal IDs changed'; END IF;
 FOR c IN SELECT b.*,s.status_code,s.rule_values FROM rule_541_cohort b JOIN animal_state_query s USING(animal_id,farm_id) LOOP
  matched:=coalesce(c.rule_values->>'LIFE_STATE'='ACTIVE' AND (((c.rule_values->>'DAYS_ON_PRESYNCH')::integer=36 AND c.status_code IN('FRESH','READY_FOR_INSEMINATION')) OR ((c.rule_values->>'DAYS_SINCE_INSEMINATION')::integer BETWEEN 42 AND 48 AND c.status_code IN('READY_FOR_INSEMINATION','FRESH'))),false);
  IF matched<>c.expected_match THEN RAISE EXCEPTION '541 fixture slot % expected %, got %',c.slot,c.expected_match,matched; END IF;
  IF c.branch='presynch' AND (c.rule_values->>'DAYS_ON_PRESYNCH')::integer<>c.days THEN RAISE EXCEPTION 'presynch day mismatch'; END IF;
  IF c.branch='insemination' AND (c.rule_values->>'DAYS_SINCE_INSEMINATION')::integer<>c.days THEN RAISE EXCEPTION 'insemination day mismatch'; END IF;
 END LOOP;
END $$;
