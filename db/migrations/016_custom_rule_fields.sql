-- Generic custom facts: one typed latest value per selected field definition.
CREATE FUNCTION rule_custom_value_json(p_value custom_event_value,p_type text)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE result jsonb;
BEGIN
 IF p_type='INTEGER' AND p_value.value_numeric<>trunc(p_value.value_numeric) THEN RAISE EXCEPTION 'CUSTOM_FACT_TYPE_MISMATCH: INTEGER'; END IF;
 result:=CASE p_type
  WHEN 'TEXT' THEN to_jsonb(p_value.value_text) WHEN 'ENUM' THEN to_jsonb(p_value.value_text)
  WHEN 'INTEGER' THEN to_jsonb(p_value.value_numeric) WHEN 'NUMERIC' THEN to_jsonb(p_value.value_numeric)
  WHEN 'BOOLEAN' THEN to_jsonb(p_value.value_boolean) WHEN 'DATE' THEN to_jsonb(p_value.value_date)
  WHEN 'TIMESTAMP' THEN to_jsonb(p_value.value_timestamp) WHEN 'REFERENCE' THEN to_jsonb(p_value.value_reference) END;
 IF result IS NULL OR (p_type IN('INTEGER','NUMERIC') AND jsonb_typeof(result)<>'number') THEN
  RAISE EXCEPTION 'CUSTOM_FACT_TYPE_MISMATCH: %',p_type;
 END IF;
 RETURN result;
END $$;
CREATE FUNCTION rule_custom_contexts(p_as_of timestamptz,p_knowledge timestamptz,p_animal_id uuid DEFAULT NULL)
RETURNS TABLE(animal_id uuid,farm_id uuid,custom_values jsonb) LANGUAGE sql STABLE AS $$
 WITH selected AS (
  SELECT DISTINCT ON(fd.farm_id,fd.code) fd.* FROM field_definition fd
  WHERE fd.is_active AND fd.source_kind='CUSTOM_EVENT_VALUE'
  AND fd.valid_from<=p_as_of AND (fd.valid_to IS NULL OR fd.valid_to>p_as_of)
  ORDER BY fd.farm_id,fd.code,fd.valid_from DESC,fd.id DESC
 ), latest AS (
  SELECT DISTINCT ON(e.animal_id,e.farm_id,fd.id) e.animal_id,e.farm_id,fd.id,
  rule_custom_value_json(v,fd.value_type) AS value
  FROM effective_animal_events(p_as_of,p_knowledge)e
  JOIN custom_event_value v ON (v.event_id,v.farm_id)=(e.id,e.farm_id)
  JOIN selected fd ON fd.id=v.field_definition_id
  WHERE p_animal_id IS NULL OR e.animal_id=p_animal_id
  ORDER BY e.animal_id,e.farm_id,fd.id,e.occurred_at DESC,e.recorded_at DESC,e.id DESC
 ) SELECT animal_id,farm_id,jsonb_object_agg(id::text,value) FROM latest GROUP BY animal_id,farm_id;
$$;
CREATE FUNCTION rule_field_registry(p_farm_id uuid,p_as_of timestamptz)
RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT coalesce(jsonb_object_agg(fd.code,
 CASE WHEN fd.source_kind='CUSTOM_EVENT_VALUE' THEN jsonb_build_object('op','CUSTOM_VALUE','fieldDefinitionId',fd.id,'valueType',fd.value_type,'definitionVersion',fd.definition_version)
 ELSE coalesce(cf.expression_ast,fd.source_ast)||jsonb_build_object('_definitionId',fd.id,'_definitionVersion',fd.definition_version,'_formulaVersion',cf.version,'_unit',fd.unit_code) END),'{}'::jsonb)
 FROM (SELECT DISTINCT ON(code) * FROM field_definition
  WHERE is_active AND (farm_id IS NULL OR farm_id=p_farm_id)
  AND valid_from<=p_as_of AND (valid_to IS NULL OR valid_to>p_as_of)
  AND (source_kind IN('CALCULATED','CUSTOM_EVENT_VALUE') OR source_ast IS NOT NULL)
  ORDER BY code,farm_id NULLS LAST,valid_from DESC,id DESC)fd
 LEFT JOIN LATERAL(SELECT expression_ast,version FROM calculated_field WHERE field_definition_id=fd.id
  AND valid_from<=p_as_of AND (valid_to IS NULL OR valid_to>p_as_of)
  ORDER BY version DESC LIMIT 1)cf ON true;
$$;
-- The public interpreter dispatches custom values through the same FIELD path.
ALTER FUNCTION evaluate_rule_expression(jsonb,jsonb,text[]) RENAME TO evaluate_rule_expression_events;
CREATE FUNCTION evaluate_rule_expression(p_ast jsonb,p_context jsonb,p_stack text[] DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
 IF cardinality(p_stack)>32 OR octet_length(p_ast::text)>65536 THEN RAISE EXCEPTION 'formula resource limit'; END IF;
 IF upper(p_ast->>'op')='CUSTOM_VALUE' THEN
  IF NOT p_context ? '_custom_values' THEN RAISE EXCEPTION 'CUSTOM_FACT_CONTEXT_MISSING'; END IF;
  RETURN p_context->'_custom_values'->(p_ast->>'fieldDefinitionId');
 END IF;
 RETURN evaluate_rule_expression_events(p_ast,p_context,p_stack);
END $$;

CREATE OR REPLACE FUNCTION evaluate_rule_expression_core(p_ast jsonb,p_context jsonb,p_stack text[] DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE op text:=upper(p_ast->>'op'); a jsonb; b jsonb; c jsonb; ast jsonb; code text; n numeric;
BEGIN
 IF cardinality(p_stack)>32 THEN RAISE EXCEPTION 'formula dependency depth exceeds 32'; END IF;
 CASE op
 WHEN 'LITERAL' THEN RETURN p_ast->'value';
 WHEN 'CONTEXT' THEN RETURN p_context->(p_ast->>'key');
 WHEN 'FIELD' THEN
  code:=p_ast->>'code';
  IF code=ANY(p_stack) THEN RAISE EXCEPTION 'formula cycle: %',code; END IF;
  IF p_context ? '_formula_registry' THEN
   ast:=p_context->'_formula_registry'->code;
  ELSE
  ast:=rule_field_registry((p_context->>'farm_id')::uuid,(p_context->>'as_of_timestamp')::timestamptz)->code;
  END IF;
  IF ast IS NULL THEN RAISE EXCEPTION 'unknown field definition: %',code; END IF;
  RETURN evaluate_rule_expression(ast,p_context,array_append(p_stack,code));
 WHEN 'COALESCE' THEN
  FOR c IN SELECT value FROM jsonb_array_elements(p_ast->'args') LOOP
   a:=evaluate_rule_expression(c,p_context,array_append(p_stack,'$'));
   IF a IS NOT NULL AND a<>'null'::jsonb THEN RETURN a; END IF;
  END LOOP; RETURN NULL;
 WHEN 'IF' THEN
  a:=evaluate_rule_expression(p_ast->'condition',p_context,array_append(p_stack,'$'));
  RETURN evaluate_rule_expression(CASE WHEN (a#>>'{}')::boolean THEN p_ast->'then' ELSE p_ast->'else' END,p_context,array_append(p_stack,'$'));
 WHEN 'DATE_DIFF','ADD','SUBTRACT','MULTIPLY','DIVIDE','EQ','GT','GTE','LT','LTE','ADD_DAYS' THEN
  a:=evaluate_rule_expression(p_ast->'left',p_context,array_append(p_stack,'$'));
  b:=evaluate_rule_expression(p_ast->'right',p_context,array_append(p_stack,'$'));
  IF a IS NULL OR b IS NULL OR a='null' OR b='null' THEN RETURN NULL; END IF;
  IF op='DATE_DIFF' THEN RETURN to_jsonb((b#>>'{}')::date-(a#>>'{}')::date); END IF;
  IF op='ADD_DAYS' THEN RETURN to_jsonb((a#>>'{}')::date+(b#>>'{}')::integer); END IF;
  IF op='EQ' THEN
   IF jsonb_typeof(a)<>jsonb_typeof(b) THEN RAISE EXCEPTION 'incompatible formula types'; END IF;
   RETURN to_jsonb(a=b);
  END IF;
  IF jsonb_typeof(a)<>'number' OR jsonb_typeof(b)<>'number' THEN RAISE EXCEPTION 'numeric operands required for %',op; END IF;
  CASE op
   WHEN 'ADD' THEN n:=(a#>>'{}')::numeric+(b#>>'{}')::numeric;
   WHEN 'SUBTRACT' THEN n:=(a#>>'{}')::numeric-(b#>>'{}')::numeric;
   WHEN 'MULTIPLY' THEN n:=(a#>>'{}')::numeric*(b#>>'{}')::numeric;
   WHEN 'DIVIDE' THEN n:=(a#>>'{}')::numeric/nullif((b#>>'{}')::numeric,0);
   WHEN 'GT' THEN RETURN to_jsonb((a#>>'{}')::numeric>(b#>>'{}')::numeric);
   WHEN 'GTE' THEN RETURN to_jsonb((a#>>'{}')::numeric>=(b#>>'{}')::numeric);
   WHEN 'LT' THEN RETURN to_jsonb((a#>>'{}')::numeric<(b#>>'{}')::numeric);
   WHEN 'LTE' THEN RETURN to_jsonb((a#>>'{}')::numeric<=(b#>>'{}')::numeric);
  END CASE; RETURN to_jsonb(n);
 ELSE RAISE EXCEPTION 'unsupported rule formula operation: %',op;
 END CASE;
END $$;
CREATE FUNCTION rule_fact_contexts(p_as_of timestamptz,p_knowledge timestamptz,p_projection boolean,p_animal_id uuid)
RETURNS TABLE(animal_id uuid,farm_id uuid,context jsonb) LANGUAGE sql STABLE AS $$
 WITH base_context(animal_id,farm_id,context) AS (
 WITH effective AS MATERIALIZED (SELECT * FROM effective_animal_events(p_as_of,p_knowledge) WHERE p_animal_id IS NULL OR animal_id=p_animal_id),
 calving AS (SELECT DISTINCT ON(animal_id) animal_id,id,occurred_at FROM effective WHERE event_code='CALVED' ORDER BY animal_id,occurred_at DESC,recorded_at DESC,id DESC),
 insemination AS (SELECT e.animal_id,e.occurred_at,row_number() OVER(PARTITION BY e.animal_id ORDER BY e.occurred_at,e.recorded_at,e.id) AS ordinal FROM effective e JOIN calving c ON c.animal_id=e.animal_id AND e.occurred_at>=c.occurred_at WHERE e.event_code='INSEMINATED'),
 start_fact AS (
 SELECT DISTINCT ON(e.animal_id) e.animal_id,d.actual_start_at,d.day_origin
 FROM effective e JOIN event_protocol_start d ON (d.event_id,d.farm_id)=(e.id,e.farm_id)
 JOIN effective assignment ON assignment.id=d.assignment_event_id
 JOIN event_protocol_assignment pa ON (pa.event_id,pa.farm_id)=(assignment.id,assignment.farm_id)
 JOIN protocol_definition pd ON pd.id=pa.protocol_id
 WHERE pd.code='PRESYNCH' AND d.actual_start_at<=p_as_of
 AND NOT EXISTS(SELECT 1 FROM effective end_event
 LEFT JOIN event_protocol_cancellation cancel ON cancel.event_id=end_event.id AND cancel.farm_id=end_event.farm_id
 LEFT JOIN event_protocol_completion done ON done.event_id=end_event.id AND done.farm_id=end_event.farm_id
 WHERE cancel.assignment_event_id=assignment.id OR done.assignment_event_id=assignment.id)
 ORDER BY e.animal_id,d.actual_start_at DESC,e.recorded_at DESC,e.id DESC),
 genomic AS (SELECT DISTINCT ON(e.animal_id) e.animal_id,d.assessed_on,d.comment FROM effective e JOIN event_external_assessment d ON (d.event_id,d.farm_id)=(e.id,e.farm_id) WHERE d.assessment_kind='GENOMIC' ORDER BY e.animal_id,e.occurred_at DESC,e.recorded_at DESC,e.id DESC),
 forecast AS (SELECT DISTINCT ON(e.animal_id) e.animal_id,d.value_numeric FROM effective e JOIN event_external_assessment d ON (d.event_id,d.farm_id)=(e.id,e.farm_id) JOIN calving c ON c.id=d.lactation_event_id WHERE d.assessment_kind='MILK_305_FORECAST' ORDER BY e.animal_id,e.occurred_at DESC,e.recorded_at DESC,e.id DESC),
 ear_tag AS (SELECT DISTINCT ON(e.animal_id) e.animal_id,d.identifier_value FROM effective e JOIN event_identifier_change d ON (d.event_id,d.farm_id)=(e.id,e.farm_id) WHERE d.identifier_type='EAR_TAG' AND d.action='ASSIGNED' AND NOT EXISTS(SELECT 1 FROM effective re JOIN event_identifier_change rd ON (rd.event_id,rd.farm_id)=(re.id,re.farm_id) WHERE rd.related_assignment_event_id=e.id AND rd.action='REMOVED') ORDER BY e.animal_id,e.occurred_at DESC,e.recorded_at DESC,e.id DESC),
 exit_fact AS (SELECT DISTINCT ON(e.animal_id) e.animal_id,d.exit_type FROM effective e JOIN event_exit d ON (d.event_id,d.farm_id)=(e.id,e.farm_id) ORDER BY e.animal_id,e.occurred_at DESC,e.recorded_at DESC,e.id DESC),
 base AS (SELECT to_jsonb(s)-'rule_values' AS value FROM animal_state_query s WHERE p_projection AND (p_animal_id IS NULL OR s.animal_id=p_animal_id) UNION ALL SELECT to_jsonb(s) FROM animal_state_at(p_as_of,p_knowledge) s WHERE NOT p_projection AND (p_animal_id IS NULL OR s.animal_id=p_animal_id))
 SELECT (b.value->>'animal_id')::uuid,f.id,b.value||jsonb_build_object(
 'as_of_timestamp',p_as_of,'knowledge_timestamp',p_knowledge,'as_of',(p_as_of AT TIME ZONE f.timezone)::date,
 'last_insemination_local_date',((b.value->>'last_insemination_at')::timestamptz AT TIME ZONE f.timezone)::date,
 'second_insemination_date',(i.occurred_at AT TIME ZONE f.timezone)::date,
 'current_lactation_date',(c.occurred_at AT TIME ZONE f.timezone)::date,
 'presynch_start_date',(st.actual_start_at AT TIME ZONE f.timezone)::date,'presynch_day_origin',st.day_origin,
 'group_name',fg.name,'ear_tag',ear.identifier_value,'genomic_date',g.assessed_on,'genomic_comment',g.comment,'forecast_305m',fc.value_numeric,
 'life_state',CASE ex.exit_type WHEN 'DIED' THEN 'DEAD' ELSE coalesce(ex.exit_type,'ACTIVE') END)
 FROM base b JOIN farm f ON f.id=(b.value->>'farm_id')::uuid
 LEFT JOIN farm_group fg ON fg.id=(b.value->>'group_id')::uuid AND fg.farm_id=f.id
 LEFT JOIN ear_tag ear ON ear.animal_id=(b.value->>'animal_id')::uuid
 LEFT JOIN calving c ON c.animal_id=(b.value->>'animal_id')::uuid
 LEFT JOIN insemination i ON i.animal_id=c.animal_id AND i.ordinal=2
 LEFT JOIN start_fact st ON st.animal_id=(b.value->>'animal_id')::uuid
 LEFT JOIN genomic g ON g.animal_id=(b.value->>'animal_id')::uuid
 LEFT JOIN forecast fc ON fc.animal_id=(b.value->>'animal_id')::uuid
 LEFT JOIN exit_fact ex ON ex.animal_id=(b.value->>'animal_id')::uuid
 ) SELECT b.animal_id,b.farm_id,b.context||jsonb_build_object('_custom_values',coalesce(c.custom_values,'{}'::jsonb))
 FROM base_context b LEFT JOIN rule_custom_contexts(p_as_of,p_knowledge,p_animal_id)c USING(animal_id,farm_id);
$$;
CREATE OR REPLACE FUNCTION rule_fact_contexts(p_as_of timestamptz,p_knowledge timestamptz,p_projection boolean DEFAULT false)
RETURNS TABLE(animal_id uuid,farm_id uuid,context jsonb) LANGUAGE sql STABLE AS $$
 SELECT * FROM rule_fact_contexts(p_as_of,p_knowledge,p_projection,NULL);
$$;
CREATE OR REPLACE FUNCTION field_value_at(p_animal_id uuid,p_field_code text,p_as_of timestamptz,p_knowledge timestamptz DEFAULT clock_timestamp())
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE ctx jsonb;
BEGIN
 SELECT context INTO ctx FROM rule_fact_contexts(p_as_of,p_knowledge,false,p_animal_id);
 IF ctx IS NULL THEN RETURN NULL; END IF;
 RETURN evaluate_rule_expression(jsonb_build_object('op','FIELD','code',p_field_code),ctx);
END $$;
CREATE OR REPLACE FUNCTION refresh_animal_rule_values(p_as_of timestamptz DEFAULT clock_timestamp(),p_knowledge timestamptz DEFAULT clock_timestamp()) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE n bigint; fingerprint text;
BEGIN
 SELECT md5(coalesce(string_agg(f.id::text||':'||rule_field_registry(f.id,p_as_of)::text,'|' ORDER BY f.id),'')) INTO fingerprint FROM farm f;
 WITH registries AS MATERIALIZED(SELECT f.id AS farm_id,rule_field_registry(f.id,p_as_of) AS registry FROM farm f),
 contexts AS MATERIALIZED(SELECT c.animal_id,c.farm_id,c.context||jsonb_build_object('_formula_registry',r.registry) AS context,r.registry
 FROM rule_fact_contexts(p_as_of,p_knowledge,true)c JOIN registries r USING(farm_id)),
 values AS (SELECT c.animal_id,c.farm_id,jsonb_object_agg(k.code,coalesce(evaluate_rule_expression(jsonb_build_object('op','FIELD','code',k.code),c.context),'null'::jsonb)) AS value
 FROM contexts c CROSS JOIN LATERAL jsonb_object_keys(c.registry)k(code) GROUP BY c.animal_id,c.farm_id)
 UPDATE animal_state_query s SET rule_values=v.value FROM values v WHERE (s.animal_id,s.farm_id)=(v.animal_id,v.farm_id);
 GET DIAGNOSTICS n=ROW_COUNT;
 INSERT INTO animal_rule_projection_snapshot(singleton,as_of,knowledge_at,formula_version,refreshed_at,stale)
 VALUES(true,p_as_of,p_knowledge,fingerprint,clock_timestamp(),false)
 ON CONFLICT(singleton) DO UPDATE SET as_of=excluded.as_of,knowledge_at=excluded.knowledge_at,formula_version=excluded.formula_version,refreshed_at=excluded.refreshed_at,stale=false;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION refresh_animal_rule_values(timestamptz,timestamptz) FROM PUBLIC,arka_reader;
CREATE TRIGGER rule_projection_invalidate AFTER INSERT OR UPDATE OR DELETE ON custom_event_value FOR EACH STATEMENT EXECUTE FUNCTION invalidate_animal_rule_values();
UPDATE animal_rule_projection_snapshot SET stale=true WHERE singleton;

CREATE OR REPLACE FUNCTION validate_custom_event_value() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  declared_type text;
  declared_farm uuid;
  declared_source text;
  actual_type text;
BEGIN
  SELECT value_type, farm_id, source_kind INTO declared_type, declared_farm, declared_source
  FROM field_definition WHERE id = NEW.field_definition_id;

  IF declared_source <> 'CUSTOM_EVENT_VALUE' THEN RAISE EXCEPTION 'custom value requires CUSTOM_EVENT_VALUE definition'; END IF;
  IF declared_farm IS NULL OR declared_farm <> NEW.farm_id THEN
    RAISE EXCEPTION 'custom event field must belong to event farm';
  END IF;

  actual_type := CASE
    WHEN NEW.value_text IS NOT NULL THEN 'TEXT'
    WHEN NEW.value_numeric IS NOT NULL THEN 'NUMERIC'
    WHEN NEW.value_boolean IS NOT NULL THEN 'BOOLEAN'
    WHEN NEW.value_date IS NOT NULL THEN 'DATE'
    WHEN NEW.value_timestamp IS NOT NULL THEN 'TIMESTAMP'
    WHEN NEW.value_reference IS NOT NULL THEN 'REFERENCE'
  END;

  IF actual_type <> declared_type
     AND NOT (actual_type = 'TEXT' AND declared_type = 'ENUM')
     AND NOT (actual_type = 'NUMERIC' AND declared_type = 'INTEGER'
              AND trunc(NEW.value_numeric) = NEW.value_numeric) THEN
    RAISE EXCEPTION 'field expects %, got %', declared_type, actual_type;
  END IF;
  RETURN NEW;
END;
$$;

-- One dispatcher for FIELD/custom/scalar expressions; event operators reuse the approved source reader.
CREATE OR REPLACE FUNCTION evaluate_rule_expression(p_ast jsonb,p_context jsonb,p_stack text[] DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE op text:=upper(p_ast->>'op'); a jsonb; b jsonb; c jsonb; ast jsonb; code text; n numeric;
BEGIN
 IF cardinality(p_stack)>32 THEN RAISE EXCEPTION 'formula dependency depth exceeds 32'; END IF;
 IF octet_length(p_ast::text)>65536 THEN RAISE EXCEPTION 'formula size budget'; END IF;
 IF op IN('EVENT_DATE','EVENT_COUNT','EVENT_VALUE','EVENT_AGGREGATE') THEN RETURN evaluate_rule_expression_events(p_ast,p_context,p_stack); END IF;
 CASE op
 WHEN 'LITERAL' THEN RETURN p_ast->'value';
 WHEN 'CUSTOM_VALUE' THEN
  IF NOT p_context ? '_custom_values' THEN RAISE EXCEPTION 'CUSTOM_FACT_CONTEXT_MISSING'; END IF;
  RETURN p_context->'_custom_values'->(p_ast->>'fieldDefinitionId');
 WHEN 'CONTEXT' THEN RETURN p_context->(p_ast->>'key');
 WHEN 'FIELD' THEN
  code:=p_ast->>'code';
  IF code=ANY(p_stack) THEN RAISE EXCEPTION 'formula cycle: %',code; END IF;
  IF p_context ? '_formula_registry' THEN
   ast:=p_context->'_formula_registry'->code;
  ELSE
  ast:=rule_field_registry((p_context->>'farm_id')::uuid,(p_context->>'as_of_timestamp')::timestamptz)->code;
  END IF;
  IF ast IS NULL THEN RAISE EXCEPTION 'unknown field definition: %',code; END IF;
  RETURN evaluate_rule_expression(ast,p_context,array_append(p_stack,code));
 WHEN 'COALESCE' THEN
  FOR c IN SELECT value FROM jsonb_array_elements(p_ast->'args') LOOP
   a:=evaluate_rule_expression(c,p_context,array_append(p_stack,'$'));
   IF a IS NOT NULL AND a<>'null'::jsonb THEN RETURN a; END IF;
  END LOOP; RETURN NULL;
 WHEN 'IF' THEN
  a:=evaluate_rule_expression(p_ast->'condition',p_context,array_append(p_stack,'$'));
  RETURN evaluate_rule_expression(CASE WHEN (a#>>'{}')::boolean THEN p_ast->'then' ELSE p_ast->'else' END,p_context,array_append(p_stack,'$'));
 WHEN 'DATE_DIFF','ADD','SUBTRACT','MULTIPLY','DIVIDE','EQ','GT','GTE','LT','LTE','ADD_DAYS' THEN
  a:=evaluate_rule_expression(p_ast->'left',p_context,array_append(p_stack,'$'));
  b:=evaluate_rule_expression(p_ast->'right',p_context,array_append(p_stack,'$'));
  IF a IS NULL OR b IS NULL OR a='null' OR b='null' THEN RETURN NULL; END IF;
  IF op='DATE_DIFF' THEN RETURN to_jsonb((b#>>'{}')::date-(a#>>'{}')::date); END IF;
  IF op='ADD_DAYS' THEN RETURN to_jsonb((a#>>'{}')::date+(b#>>'{}')::integer); END IF;
  IF op='EQ' THEN
   IF jsonb_typeof(a)<>jsonb_typeof(b) THEN RAISE EXCEPTION 'incompatible formula types'; END IF;
   RETURN to_jsonb(a=b);
  END IF;
  IF jsonb_typeof(a)<>'number' OR jsonb_typeof(b)<>'number' THEN RAISE EXCEPTION 'numeric operands required for %',op; END IF;
  CASE op
   WHEN 'ADD' THEN n:=(a#>>'{}')::numeric+(b#>>'{}')::numeric;
   WHEN 'SUBTRACT' THEN n:=(a#>>'{}')::numeric-(b#>>'{}')::numeric;
   WHEN 'MULTIPLY' THEN n:=(a#>>'{}')::numeric*(b#>>'{}')::numeric;
   WHEN 'DIVIDE' THEN n:=(a#>>'{}')::numeric/nullif((b#>>'{}')::numeric,0);
   WHEN 'GT' THEN RETURN to_jsonb((a#>>'{}')::numeric>(b#>>'{}')::numeric);
   WHEN 'GTE' THEN RETURN to_jsonb((a#>>'{}')::numeric>=(b#>>'{}')::numeric);
   WHEN 'LT' THEN RETURN to_jsonb((a#>>'{}')::numeric<(b#>>'{}')::numeric);
   WHEN 'LTE' THEN RETURN to_jsonb((a#>>'{}')::numeric<=(b#>>'{}')::numeric);
  END CASE; RETURN to_jsonb(n);
 ELSE RAISE EXCEPTION 'unsupported rule formula operation: %',op;
 END CASE;
END $$;
