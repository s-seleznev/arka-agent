CREATE FUNCTION event_date_at(
  p_animal_id uuid,
  p_event_code text,
  p_position integer,
  p_as_of timestamptz,
  p_knowledge timestamptz DEFAULT clock_timestamp()
) RETURNS timestamptz
LANGUAGE sql STABLE AS $$
  SELECT occurred_at
  FROM effective_animal_events(p_as_of,p_knowledge)
  WHERE animal_id=p_animal_id AND event_code=p_event_code
  ORDER BY occurred_at DESC, recorded_at DESC
  OFFSET greatest(p_position - 1, 0) LIMIT 1;
$$;

CREATE FUNCTION event_count_at(
  p_animal_id uuid,
  p_event_code text,
  p_from timestamptz,
  p_as_of timestamptz,
  p_knowledge timestamptz DEFAULT clock_timestamp()
) RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT count(*)::integer
  FROM effective_animal_events(p_as_of,p_knowledge)
  WHERE animal_id=p_animal_id AND event_code=p_event_code AND occurred_at >= p_from;
$$;

CREATE FUNCTION event_numeric_values_at(
  p_animal_id uuid,
  p_event_code text,
  p_value_code text,
  p_from timestamptz,
  p_as_of timestamptz,
  p_knowledge timestamptz DEFAULT clock_timestamp()
) RETURNS TABLE (occurred_at timestamptz, recorded_at timestamptz, value_numeric numeric)
LANGUAGE sql STABLE AS $$
  SELECT e.occurred_at,e.recorded_at,
    CASE
      WHEN p_event_code='DAILY_MILK_RECORDED' AND p_value_code='MILK_KG' THEN dm.milk_kg
      WHEN p_event_code='MILKED' AND p_value_code='MILK_KG' THEN m.milk_kg
      WHEN p_event_code='MILK_TESTED' AND p_value_code='FAT_PERCENT' THEN mt.fat_percent
      WHEN p_event_code='MILK_TESTED' AND p_value_code='PROTEIN_PERCENT' THEN mt.protein_percent
      WHEN p_event_code='MILK_TESTED' AND p_value_code='SOMATIC_CELLS' THEN mt.somatic_cells
      WHEN p_event_code='MEASURED' AND em.measurement_code=p_value_code THEN em.value_numeric
    END
  FROM effective_animal_events(p_as_of,p_knowledge) e
  LEFT JOIN event_daily_milk dm ON (dm.event_id,dm.farm_id)=(e.id,e.farm_id)
  LEFT JOIN event_milking m ON (m.event_id,m.farm_id)=(e.id,e.farm_id)
  LEFT JOIN event_milk_test mt ON (mt.event_id,mt.farm_id)=(e.id,e.farm_id)
  LEFT JOIN event_measurement em ON (em.event_id,em.farm_id)=(e.id,e.farm_id)
  WHERE e.animal_id=p_animal_id AND e.event_code=p_event_code
    AND e.occurred_at >= p_from
    AND CASE
      WHEN p_event_code='DAILY_MILK_RECORDED' THEN p_value_code='MILK_KG'
      WHEN p_event_code='MILKED' THEN p_value_code='MILK_KG'
      WHEN p_event_code='MILK_TESTED' THEN p_value_code IN ('FAT_PERCENT','PROTEIN_PERCENT','SOMATIC_CELLS')
      WHEN p_event_code='MEASURED' THEN em.measurement_code=p_value_code
      ELSE false END;
$$;

CREATE FUNCTION event_numeric_aggregate_at(
  p_animal_id uuid,
  p_event_code text,
  p_value_code text,
  p_operation text,
  p_from timestamptz,
  p_as_of timestamptz,
  p_knowledge timestamptz DEFAULT clock_timestamp()
) RETURNS numeric
LANGUAGE plpgsql STABLE AS $$
DECLARE result numeric;
BEGIN
  IF upper(p_operation) = 'LAG' THEN
    SELECT value_numeric INTO result
    FROM event_numeric_values_at(p_animal_id,p_event_code,p_value_code,p_from,p_as_of,p_knowledge)
    ORDER BY occurred_at DESC, recorded_at DESC OFFSET 1 LIMIT 1;
  ELSIF upper(p_operation) = 'LATEST' THEN
    SELECT value_numeric INTO result
    FROM event_numeric_values_at(p_animal_id,p_event_code,p_value_code,p_from,p_as_of,p_knowledge)
    ORDER BY occurred_at DESC, recorded_at DESC LIMIT 1;
  ELSIF upper(p_operation) IN ('SUM','AVG','MIN','MAX') THEN
    SELECT CASE upper(p_operation)
      WHEN 'SUM' THEN sum(value_numeric)
      WHEN 'AVG' THEN avg(value_numeric)
      WHEN 'MIN' THEN min(value_numeric)
      WHEN 'MAX' THEN max(value_numeric) END
    INTO result
    FROM event_numeric_values_at(p_animal_id,p_event_code,p_value_code,p_from,p_as_of,p_knowledge);
  ELSE
    RAISE EXCEPTION 'unsupported aggregate operation: %', p_operation;
  END IF;
  RETURN result;
END;
$$;

CREATE FUNCTION evaluate_formula_ast(
  p_animal_id uuid,
  p_ast jsonb,
  p_as_of timestamptz,
  p_knowledge timestamptz DEFAULT clock_timestamp()
) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE
  op text := upper(p_ast->>'op');
  left_value jsonb;
  right_value jsonb;
  condition_value jsonb;
  result_boolean boolean;
  item jsonb;
  result_numeric numeric;
  from_at timestamptz;
BEGIN
  CASE op
    WHEN 'LITERAL' THEN RETURN p_ast->'value';
    WHEN 'FIELD' THEN
      RETURN field_value_at(p_animal_id,p_ast->>'code',p_as_of,p_knowledge);
    WHEN 'LATEST_EVENT_DATE' THEN
      RETURN to_jsonb(event_date_at(p_animal_id,p_ast->>'event',1,p_as_of,p_knowledge)::date);
    WHEN 'NTH_EVENT_DATE' THEN
      RETURN to_jsonb(event_date_at(p_animal_id,p_ast->>'event',(p_ast->>'position')::integer,p_as_of,p_knowledge)::date);
    WHEN 'COUNT_EVENTS' THEN
      from_at := COALESCE((p_ast->>'from')::timestamptz,'-infinity'::timestamptz);
      RETURN to_jsonb(event_count_at(p_animal_id,p_ast->>'event',from_at,p_as_of,p_knowledge));
    WHEN 'SUM', 'AVG', 'MIN', 'MAX', 'LATEST', 'LAG' THEN
      from_at := COALESCE((p_ast->>'from')::timestamptz,'-infinity'::timestamptz);
      RETURN to_jsonb(event_numeric_aggregate_at(
        p_animal_id,p_ast->>'event',p_ast->>'value',op,from_at,p_as_of,p_knowledge));
    WHEN 'DAYS_BETWEEN' THEN
      left_value := evaluate_formula_ast(p_animal_id,p_ast->'from',p_as_of,p_knowledge);
      right_value := evaluate_formula_ast(p_animal_id,p_ast->'to',p_as_of,p_knowledge);
      RETURN to_jsonb(((right_value #>> '{}')::date - (left_value #>> '{}')::date)::integer);
    WHEN 'ADD_DURATION' THEN
      left_value := evaluate_formula_ast(p_animal_id,p_ast->'date',p_as_of,p_knowledge);
      right_value := evaluate_formula_ast(p_animal_id,p_ast->'days',p_as_of,p_knowledge);
      RETURN to_jsonb((left_value #>> '{}')::date + (right_value #>> '{}')::integer);
    WHEN 'RATIO' THEN
      left_value := evaluate_formula_ast(p_animal_id,p_ast->'numerator',p_as_of,p_knowledge);
      right_value := evaluate_formula_ast(p_animal_id,p_ast->'denominator',p_as_of,p_knowledge);
      IF (right_value #>> '{}')::numeric = 0 THEN RETURN NULL; END IF;
      RETURN to_jsonb((left_value #>> '{}')::numeric / (right_value #>> '{}')::numeric);
    WHEN 'ROUND' THEN
      left_value := evaluate_formula_ast(p_animal_id,p_ast->'value',p_as_of,p_knowledge);
      RETURN to_jsonb(round((left_value #>> '{}')::numeric,COALESCE((p_ast->>'scale')::integer,0)));
    WHEN 'FLOOR' THEN
      left_value := evaluate_formula_ast(p_animal_id,p_ast->'value',p_as_of,p_knowledge);
      RETURN to_jsonb(floor((left_value #>> '{}')::numeric));
    WHEN 'EQ', 'GT', 'GTE', 'LT', 'LTE' THEN
      left_value := evaluate_formula_ast(p_animal_id,p_ast->'left',p_as_of,p_knowledge);
      right_value := evaluate_formula_ast(p_animal_id,p_ast->'right',p_as_of,p_knowledge);
      IF jsonb_typeof(left_value) = 'number' AND jsonb_typeof(right_value) = 'number' THEN
        result_boolean := CASE op
          WHEN 'EQ' THEN (left_value #>> '{}')::numeric = (right_value #>> '{}')::numeric
          WHEN 'GT' THEN (left_value #>> '{}')::numeric > (right_value #>> '{}')::numeric
          WHEN 'GTE' THEN (left_value #>> '{}')::numeric >= (right_value #>> '{}')::numeric
          WHEN 'LT' THEN (left_value #>> '{}')::numeric < (right_value #>> '{}')::numeric
          WHEN 'LTE' THEN (left_value #>> '{}')::numeric <= (right_value #>> '{}')::numeric END;
      ELSE
        result_boolean := CASE op
          WHEN 'EQ' THEN left_value = right_value
          WHEN 'GT' THEN (left_value #>> '{}') > (right_value #>> '{}')
          WHEN 'GTE' THEN (left_value #>> '{}') >= (right_value #>> '{}')
          WHEN 'LT' THEN (left_value #>> '{}') < (right_value #>> '{}')
          WHEN 'LTE' THEN (left_value #>> '{}') <= (right_value #>> '{}') END;
      END IF;
      RETURN to_jsonb(result_boolean);
    WHEN 'AND', 'OR' THEN
      result_boolean := (op = 'AND');
      FOR item IN SELECT value FROM jsonb_array_elements(p_ast->'args') LOOP
        condition_value := evaluate_formula_ast(p_animal_id,item,p_as_of,p_knowledge);
        IF op='AND' THEN result_boolean := result_boolean AND (condition_value #>> '{}')::boolean;
        ELSE result_boolean := result_boolean OR (condition_value #>> '{}')::boolean; END IF;
      END LOOP;
      RETURN to_jsonb(result_boolean);
    WHEN 'IF' THEN
      condition_value := evaluate_formula_ast(p_animal_id,p_ast->'condition',p_as_of,p_knowledge);
      IF (condition_value #>> '{}')::boolean THEN
        RETURN evaluate_formula_ast(p_animal_id,p_ast->'then',p_as_of,p_knowledge);
      END IF;
      RETURN evaluate_formula_ast(p_animal_id,p_ast->'else',p_as_of,p_knowledge);
    ELSE RAISE EXCEPTION 'unsupported formula operation: %', op;
  END CASE;
END;
$$;
