-- Additive rule facts. CSV semantics remain tracked by product bindings.
CREATE TABLE event_protocol_start (
 event_id uuid NOT NULL, farm_id uuid NOT NULL, assignment_event_id uuid NOT NULL,
 actual_start_at timestamptz NOT NULL, day_origin smallint NOT NULL DEFAULT 0 CHECK(day_origin IN (0,1)),
 provenance text NOT NULL,
 PRIMARY KEY(event_id,farm_id), FOREIGN KEY(event_id,farm_id) REFERENCES animal_event(id,farm_id),
 FOREIGN KEY(assignment_event_id,farm_id) REFERENCES event_protocol_assignment(event_id,farm_id)
);
CREATE TABLE event_external_assessment (
 event_id uuid NOT NULL, farm_id uuid NOT NULL,
 assessment_kind text NOT NULL CHECK(assessment_kind IN ('GENOMIC','MILK_305_FORECAST')),
 assessed_on date NOT NULL, value_numeric numeric, comment text,
 lactation_event_id uuid, methodology text NOT NULL, provenance text NOT NULL,
 PRIMARY KEY(event_id,farm_id), FOREIGN KEY(event_id,farm_id) REFERENCES animal_event(id,farm_id),
 FOREIGN KEY(lactation_event_id,farm_id) REFERENCES event_calving(event_id,farm_id),
 CHECK(assessment_kind <> 'MILK_305_FORECAST' OR (lactation_event_id IS NOT NULL AND value_numeric IS NOT NULL AND value_numeric >= 0))
);
CREATE FUNCTION validate_rule_fact_links() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id uuid; linked_id uuid;
BEGIN
 SELECT animal_id INTO owner_id FROM animal_event WHERE id=NEW.event_id AND farm_id=NEW.farm_id;
 IF TG_TABLE_NAME='event_protocol_start' THEN
  SELECT animal_id INTO linked_id FROM animal_event WHERE id=NEW.assignment_event_id;
 ELSE
  IF NEW.lactation_event_id IS NULL THEN RETURN NEW; END IF;
  SELECT animal_id INTO linked_id FROM animal_event WHERE id=NEW.lactation_event_id;
 END IF;
 IF owner_id IS DISTINCT FROM linked_id THEN RAISE EXCEPTION 'rule fact links another animal'; END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['event_protocol_start','event_external_assessment'] LOOP
  EXECUTE format('CREATE TRIGGER validate_detail BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION validate_detail_table()',t);
  EXECUTE format('CREATE TRIGGER validate_links BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION validate_rule_fact_links()',t);
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY farm_isolation ON %I FOR SELECT TO arka_reader USING (farm_id=ANY(CASE WHEN coalesce(current_setting(''arka.farm_ids'',true),'''')<>'''' THEN string_to_array(current_setting(''arka.farm_ids'',true),'','')::uuid[] ELSE ARRAY[nullif(current_setting(''arka.farm_id'',true),'''')::uuid] END))',t);
 END LOOP;
END $$;
INSERT INTO event_type(id,code,family,detail_table)
VALUES (md5('event-type:PROTOCOL_STARTED')::uuid,'PROTOCOL_STARTED','PROTOCOL','event_protocol_start'),
(md5('event-type:EXTERNAL_ASSESSMENT')::uuid,'EXTERNAL_ASSESSMENT','ASSESSMENT','event_external_assessment');
ALTER TABLE field_definition ADD COLUMN source_ast jsonb,
 ADD COLUMN definition_version integer NOT NULL DEFAULT 1,
 ADD COLUMN provenance jsonb NOT NULL DEFAULT '{}'::jsonb;
-- Interpreter reads versioned calculated_field definitions, never SQL from a rule.
CREATE FUNCTION evaluate_rule_expression(p_ast jsonb,p_context jsonb,p_stack text[] DEFAULT '{}')
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
  SELECT coalesce(cf.expression_ast,fd.source_ast) INTO ast FROM field_definition fd
  LEFT JOIN LATERAL (SELECT expression_ast FROM calculated_field WHERE field_definition_id=fd.id
   AND valid_from <= (p_context->>'as_of_timestamp')::timestamptz
   AND (valid_to IS NULL OR valid_to > (p_context->>'as_of_timestamp')::timestamptz)
   ORDER BY version DESC LIMIT 1) cf ON true
  WHERE fd.code=code AND fd.is_active AND (fd.farm_id IS NULL OR fd.farm_id=(p_context->>'farm_id')::uuid)
   AND fd.valid_from <= (p_context->>'as_of_timestamp')::timestamptz
   AND (fd.valid_to IS NULL OR fd.valid_to > (p_context->>'as_of_timestamp')::timestamptz)
  ORDER BY fd.farm_id NULLS LAST,fd.valid_from DESC LIMIT 1;
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
-- Base context is a vocabulary of facts, not a switch on calculated field names.
CREATE FUNCTION rule_fact_contexts(p_as_of timestamptz,p_knowledge timestamptz,p_projection boolean DEFAULT false)
RETURNS TABLE(animal_id uuid,farm_id uuid,context jsonb) LANGUAGE sql STABLE AS $$
 WITH effective AS MATERIALIZED (SELECT * FROM effective_animal_events(p_as_of,p_knowledge)),
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
 base AS (SELECT to_jsonb(s)-'rule_values' AS value FROM animal_state_query s WHERE p_projection UNION ALL SELECT to_jsonb(s) FROM animal_state_at(p_as_of,p_knowledge) s WHERE NOT p_projection)
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
 LEFT JOIN exit_fact ex ON ex.animal_id=(b.value->>'animal_id')::uuid;
$$;
-- Existing version 1 is retained; version 2 normalizes seeds and preserves baseline values.
INSERT INTO calculated_field(id,field_definition_id,version,expression_ast,description,valid_from)
SELECT md5('rule-normalized:'||fd.code)::uuid,fd.id,2,
 jsonb_build_object('op','CONTEXT','key',CASE fd.code
 WHEN 'AGE_DAYS' THEN 'age_days' WHEN 'LACTATION_NUMBER' THEN 'lactation_number'
 WHEN 'DAYS_IN_MILK' THEN 'days_in_milk' WHEN 'EXPECTED_CALVING_DATE' THEN 'expected_calving_date'
 WHEN 'EXPECTED_DRY_OFF_DATE' THEN 'expected_dry_off_date' WHEN 'LAST_MILK_KG' THEN 'last_milk_kg'
 WHEN 'LAST_WEIGHT_KG' THEN 'last_weight_kg' END),
 'Canonical context v2; preserves established projection semantics',fd.valid_from
FROM field_definition fd WHERE fd.farm_id IS NULL AND fd.code IN('AGE_DAYS','LACTATION_NUMBER','DAYS_IN_MILK','EXPECTED_CALVING_DATE','EXPECTED_DRY_OFF_DATE','LAST_MILK_KG','LAST_WEIGHT_KG');
INSERT INTO calculated_field(id,field_definition_id,version,expression_ast,description,valid_from)
SELECT md5('rule-normalized:'||code)::uuid,id,2,
 '{"op":"DATE_DIFF","left":{"op":"CONTEXT","key":"last_insemination_local_date"},"right":{"op":"CONTEXT","key":"as_of"}}',
 'Canonical date difference',valid_from FROM field_definition WHERE farm_id IS NULL AND code='DAYS_SINCE_INSEMINATION';
WITH source(code,name,type,unit,ast) AS (VALUES
 ('DAYS_ON_PRESYNCH','Дней на пресинге','INTEGER','DAY','{"op":"ADD","left":{"op":"DATE_DIFF","left":{"op":"CONTEXT","key":"presynch_start_date"},"right":{"op":"CONTEXT","key":"as_of"}},"right":{"op":"CONTEXT","key":"presynch_day_origin"}}'::jsonb),
 ('SECOND_INSEMINATION_DATE_CURRENT_LACTATION','Дата 2 осеменения тек.лакт','DATE',NULL,'{"op":"CONTEXT","key":"second_insemination_date"}'),
 ('DAYS_IN_MILK_AT_SECOND_INSEMINATION','Дни доения при 2 осем тек.лакт','INTEGER','DAY','{"op":"DATE_DIFF","left":{"op":"CONTEXT","key":"current_lactation_date"},"right":{"op":"FIELD","code":"SECOND_INSEMINATION_DATE_CURRENT_LACTATION"}}'),
 ('GENOMIC_EVALUATION_DATE','Дата геномной оценки','DATE',NULL,'{"op":"CONTEXT","key":"genomic_date"}'),
 ('GENOMIC_EVALUATION_COMMENT','Комментарий геномной оценки (при наличии)','TEXT',NULL,'{"op":"CONTEXT","key":"genomic_comment"}'),
 ('FORECAST_305M_CURRENT_LACTATION','Прогноз 305M тек.лакт','NUMERIC','KG','{"op":"CONTEXT","key":"forecast_305m"}'),
 ('GROUP_NAME','Название группы','TEXT',NULL,'{"op":"CONTEXT","key":"group_name"}'),
 ('EAR_TAG','Ушная бирка','TEXT',NULL,'{"op":"CONTEXT","key":"ear_tag"}'),
 ('LIFE_STATE','Жизненное состояние','ENUM',NULL,'{"op":"CONTEXT","key":"life_state"}')
)
INSERT INTO field_definition(id,code,name,scope,value_type,unit_code,source_kind,is_system,source_ast,provenance)
SELECT md5('field:'||code)::uuid,code,name,'ANIMAL',type,unit,'CALCULATED',true,ast,
 CASE WHEN code='DAYS_ON_PRESYNCH' THEN '{"semanticStatus":"assumption","dayOrigin":"stored per start; generated fixture uses zero","sourceFormulaRestored":false}'::jsonb
 WHEN code='FORECAST_305M_CURRENT_LACTATION' THEN '{"kind":"external assessment","methodologyRestored":false}'::jsonb
 ELSE '{"kind":"effective event facts"}'::jsonb END FROM source;
INSERT INTO calculated_field(id,field_definition_id,version,expression_ast,description,valid_from)
SELECT md5('rule-formula:'||code)::uuid,id,1,source_ast,'Rule fact definition',valid_from FROM field_definition WHERE source_ast IS NOT NULL;
ALTER FUNCTION field_value_at(uuid,text,timestamptz,timestamptz) RENAME TO field_value_at_legacy;
CREATE FUNCTION field_value_at(p_animal_id uuid,p_field_code text,p_as_of timestamptz,p_knowledge timestamptz DEFAULT clock_timestamp()) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE ctx jsonb;
BEGIN
 IF EXISTS(SELECT 1 FROM field_definition WHERE code=p_field_code AND source_kind='CUSTOM_EVENT_VALUE') THEN
  RETURN field_value_at_legacy(p_animal_id,p_field_code,p_as_of,p_knowledge);
 END IF;
 SELECT context INTO ctx FROM rule_fact_contexts(p_as_of,p_knowledge,false) WHERE animal_id=p_animal_id;
 IF ctx IS NULL THEN RETURN NULL; END IF;
 RETURN evaluate_rule_expression(jsonb_build_object('op','FIELD','code',p_field_code),ctx);
END $$;
ALTER TABLE animal_state_query ADD COLUMN rule_values jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE animal_rule_projection_snapshot (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), as_of timestamptz NOT NULL,
 knowledge_at timestamptz NOT NULL, formula_version text NOT NULL, refreshed_at timestamptz NOT NULL, stale boolean NOT NULL DEFAULT false
);
CREATE FUNCTION refresh_animal_rule_values(p_as_of timestamptz DEFAULT clock_timestamp(),p_knowledge timestamptz DEFAULT clock_timestamp()) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE n bigint; formula_fingerprint text;
BEGIN
 SELECT md5(coalesce(string_agg(fd.id::text||':'||fd.definition_version||':'||coalesce(cf.version::text,'0')||':'||coalesce(cf.expression_ast,fd.source_ast)::text,'|' ORDER BY fd.id,cf.version),'')) INTO formula_fingerprint
 FROM field_definition fd LEFT JOIN calculated_field cf ON cf.field_definition_id=fd.id
 WHERE fd.is_active AND fd.valid_from<=p_as_of AND (fd.valid_to IS NULL OR fd.valid_to>p_as_of)
 AND (cf.id IS NULL OR (cf.valid_from<=p_as_of AND (cf.valid_to IS NULL OR cf.valid_to>p_as_of)));
 WITH registries AS MATERIALIZED(
 SELECT f.id AS farm_id,(SELECT jsonb_object_agg(d.code,coalesce(cf.expression_ast,d.source_ast))
 FROM (SELECT DISTINCT ON(fd.code) fd.* FROM field_definition fd
 WHERE (fd.farm_id IS NULL OR fd.farm_id=f.id) AND fd.is_active AND fd.source_kind='CALCULATED'
 AND fd.valid_from<=p_as_of AND (fd.valid_to IS NULL OR fd.valid_to>p_as_of)
 ORDER BY fd.code,fd.farm_id NULLS LAST,fd.valid_from DESC)d
 LEFT JOIN LATERAL(SELECT expression_ast FROM calculated_field
 WHERE field_definition_id=d.id AND valid_from<=p_as_of AND (valid_to IS NULL OR valid_to>p_as_of)
 ORDER BY version DESC LIMIT 1)cf ON true) AS registry FROM farm f),
 contexts AS MATERIALIZED(SELECT c.animal_id,c.farm_id,c.context||jsonb_build_object('_formula_registry',r.registry) AS context,r.registry
 FROM rule_fact_contexts(p_as_of,p_knowledge,true)c JOIN registries r USING(farm_id)),
 values AS (SELECT c.animal_id,c.farm_id,jsonb_object_agg(keys.code,coalesce(evaluate_rule_expression(jsonb_build_object('op','FIELD','code',keys.code),c.context),'null'::jsonb)) AS value
 FROM contexts c CROSS JOIN LATERAL jsonb_object_keys(c.registry) keys(code) GROUP BY c.animal_id,c.farm_id)
 UPDATE animal_state_query s SET rule_values=v.value FROM values v WHERE (s.animal_id,s.farm_id)=(v.animal_id,v.farm_id);
 GET DIAGNOSTICS n=ROW_COUNT;
 INSERT INTO animal_rule_projection_snapshot(singleton,as_of,knowledge_at,formula_version,refreshed_at) VALUES(true,p_as_of,p_knowledge,formula_fingerprint,clock_timestamp())
 ON CONFLICT(singleton) DO UPDATE SET as_of=excluded.as_of,knowledge_at=excluded.knowledge_at,formula_version=excluded.formula_version,refreshed_at=excluded.refreshed_at,stale=false;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION refresh_animal_rule_values(timestamptz,timestamptz) FROM PUBLIC,arka_reader;
GRANT SELECT ON animal_rule_projection_snapshot TO arka_reader;
-- Do not alter the established refresh SELECT * shape: wrapper implementation follows in 014.
