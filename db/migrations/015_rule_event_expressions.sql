-- Trusted storage vocabulary. Rules can name approved fact keys, never SQL.
CREATE TABLE rule_event_source (
 event_code text PRIMARY KEY, detail_table regclass NOT NULL, allowed_columns text[] NOT NULL
);
INSERT INTO rule_event_source
SELECT et.code,('public.'||et.detail_table)::regclass,array_agg(c.column_name ORDER BY c.ordinal_position)
FROM event_type et JOIN information_schema.columns c ON c.table_schema='public' AND c.table_name=et.detail_table
WHERE et.farm_id IS NULL GROUP BY et.code,et.detail_table;
REVOKE ALL ON rule_event_source FROM PUBLIC;
GRANT SELECT ON rule_event_source TO arka_reader;
CREATE FUNCTION rule_event_records(p_animal uuid,p_event text,p_as_of timestamptz,p_knowledge timestamptz)
RETURNS TABLE(id uuid,occurred_at timestamptz,recorded_at timestamptz,details jsonb)
LANGUAGE plpgsql STABLE AS $$
DECLARE source_table regclass;
BEGIN
 SELECT detail_table INTO source_table FROM rule_event_source WHERE event_code=p_event;
 IF source_table IS NULL THEN RAISE EXCEPTION 'unknown event source: %',p_event; END IF;
 RETURN QUERY EXECUTE format('SELECT e.id,e.occurred_at,e.recorded_at,to_jsonb(d) FROM effective_animal_events($1,$2) e JOIN %s d ON (d.event_id,d.farm_id)=(e.id,e.farm_id) WHERE e.animal_id=$3 AND e.event_code=$4',source_table)
 USING p_as_of,p_knowledge,p_animal,p_event;
END $$;
ALTER FUNCTION evaluate_rule_expression(jsonb,jsonb,text[]) RENAME TO evaluate_rule_expression_core;
CREATE FUNCTION evaluate_rule_expression(p_ast jsonb,p_context jsonb,p_stack text[] DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
 op text:=upper(p_ast->>'op'); v_event_code text:=p_ast->>'event'; scope text:=coalesce(p_ast->>'scope','LIFETIME');
 asof timestamptz:=(p_context->>'as_of_timestamp')::timestamptz;
 knowledge timestamptz:=coalesce((p_context->>'knowledge_timestamp')::timestamptz,asof);
 animal uuid:=(p_context->>'animal_id')::uuid; zone text;
 from_at timestamptz:='-infinity'; to_at timestamptz:=asof;
 key text; allowed text[]; nth integer:=coalesce((p_ast->>'position')::integer,1);
 direction text:=coalesce(upper(p_ast->>'order'),'DESC'); value_key text:=p_ast->>'value';
 result jsonb; agg text:=upper(coalesce(p_ast->>'aggregate','LATEST')); filters jsonb:=coalesce(p_ast->'where','{}');
BEGIN
 IF octet_length(p_ast::text)>65536 THEN RAISE EXCEPTION 'formula exceeds size budget'; END IF;
 IF cardinality(p_stack)>32 THEN RAISE EXCEPTION 'formula dependency depth exceeds 32'; END IF;
 IF op NOT IN('EVENT_DATE','EVENT_COUNT','EVENT_VALUE','EVENT_AGGREGATE') THEN
  RETURN evaluate_rule_expression_core(p_ast,p_context,p_stack);
 END IF;
 IF nth<1 OR nth>10000 OR direction NOT IN('ASC','DESC') THEN RAISE EXCEPTION 'invalid event position/order'; END IF;
 IF jsonb_typeof(filters)<>'object' OR length(filters::text)>8192 THEN RAISE EXCEPTION 'invalid event filters'; END IF;
 SELECT allowed_columns INTO allowed FROM rule_event_source WHERE rule_event_source.event_code=v_event_code;
 IF allowed IS NULL THEN RAISE EXCEPTION 'unknown event source: %',v_event_code; END IF;
 FOR key IN SELECT jsonb_object_keys(filters) LOOP
  IF NOT(key=ANY(allowed)) THEN RAISE EXCEPTION 'unknown event detail filter: %',key; END IF;
 END LOOP;
 IF op IN('EVENT_VALUE','EVENT_AGGREGATE') AND (value_key IS NULL OR NOT(value_key=ANY(allowed))) THEN RAISE EXCEPTION 'unknown event detail value: %',value_key; END IF;
 SELECT timezone INTO zone FROM farm WHERE id=(p_context->>'farm_id')::uuid;
 IF scope IN('CURRENT_LACTATION','PREVIOUS_LACTATION') THEN
  SELECT occurred_at INTO from_at FROM rule_event_records(animal,'CALVED',asof,knowledge)
  ORDER BY occurred_at DESC,recorded_at DESC,id DESC OFFSET CASE WHEN scope='PREVIOUS_LACTATION' THEN 1 ELSE 0 END LIMIT 1;
  IF from_at IS NULL THEN RETURN CASE WHEN op='EVENT_COUNT' THEN '0'::jsonb ELSE NULL END; END IF;
  IF scope='PREVIOUS_LACTATION' THEN
   SELECT occurred_at INTO to_at FROM rule_event_records(animal,'CALVED',asof,knowledge) ORDER BY occurred_at DESC,recorded_at DESC,id DESC LIMIT 1;
  END IF;
 ELSIF scope='WINDOW' THEN
  IF p_ast ? 'from' THEN from_at:=((evaluate_rule_expression(p_ast->'from',p_context,array_append(p_stack,'$'))#>>'{}')::date::timestamp AT TIME ZONE zone); END IF;
  IF p_ast ? 'to' THEN to_at:=(((evaluate_rule_expression(p_ast->'to',p_context,array_append(p_stack,'$'))#>>'{}')::date+1)::timestamp AT TIME ZONE zone); END IF;
 ELSIF scope<>'LIFETIME' THEN RAISE EXCEPTION 'unknown event scope: %',scope;
 END IF;
 IF op='EVENT_COUNT' THEN
  SELECT to_jsonb(count(*)) INTO result FROM rule_event_records(animal,v_event_code,asof,knowledge) r
  WHERE r.occurred_at>=from_at AND (CASE WHEN scope IN('WINDOW','PREVIOUS_LACTATION') THEN r.occurred_at<to_at ELSE r.occurred_at<=to_at END) AND r.details @> filters;
 ELSE
  WITH records AS (SELECT * FROM rule_event_records(animal,v_event_code,asof,knowledge) r WHERE r.occurred_at>=from_at AND (CASE WHEN scope IN('WINDOW','PREVIOUS_LACTATION') THEN r.occurred_at<to_at ELSE r.occurred_at<=to_at END) AND r.details @> filters)
  SELECT CASE WHEN op='EVENT_DATE' THEN to_jsonb((r.occurred_at AT TIME ZONE zone)::date) ELSE r.details->value_key END INTO result FROM records r
  ORDER BY CASE WHEN direction='ASC' THEN r.occurred_at END ASC,CASE WHEN direction='DESC' THEN r.occurred_at END DESC,
  CASE WHEN direction='ASC' THEN r.recorded_at END ASC,CASE WHEN direction='DESC' THEN r.recorded_at END DESC,
  CASE WHEN direction='ASC' THEN r.id END ASC,CASE WHEN direction='DESC' THEN r.id END DESC OFFSET nth-1 LIMIT 1;
  IF op='EVENT_AGGREGATE' AND agg<>'LATEST' THEN
   IF agg NOT IN('SUM','AVG','MIN','MAX') THEN RAISE EXCEPTION 'unknown event aggregate: %',agg; END IF;
   IF EXISTS(SELECT 1 FROM rule_event_records(animal,v_event_code,asof,knowledge) r WHERE r.occurred_at>=from_at AND r.occurred_at<=to_at AND r.details @> filters AND jsonb_typeof(r.details->value_key) NOT IN('number','null')) THEN RAISE EXCEPTION 'aggregate requires numeric detail'; END IF;
   SELECT to_jsonb(CASE agg WHEN 'SUM' THEN sum((r.details->>value_key)::numeric) WHEN 'AVG' THEN avg((r.details->>value_key)::numeric) WHEN 'MIN' THEN min((r.details->>value_key)::numeric) WHEN 'MAX' THEN max((r.details->>value_key)::numeric) END) INTO result
   FROM rule_event_records(animal,v_event_code,asof,knowledge) r WHERE r.occurred_at>=from_at AND (CASE WHEN scope IN('WINDOW','PREVIOUS_LACTATION') THEN r.occurred_at<to_at ELSE r.occurred_at<=to_at END) AND r.details @> filters;
  END IF;
 END IF;
 RETURN result;
END $$;
-- Use the same server-authorized multi-farm scope as the main projection.
DO $$ DECLARE policy record; BEGIN
 FOR policy IN SELECT p.tablename,p.policyname FROM pg_policies p
 JOIN information_schema.columns c ON c.table_schema=p.schemaname AND c.table_name=p.tablename AND c.column_name='farm_id'
 WHERE p.schemaname='public' AND p.cmd='SELECT' AND 'arka_reader'=ANY(p.roles)
 LOOP
  EXECUTE format('ALTER POLICY %I ON %I USING (farm_id IS NULL OR farm_id=ANY(CASE WHEN coalesce(current_setting(''arka.farm_ids'',true),'''')<>'''' THEN string_to_array(current_setting(''arka.farm_ids'',true),'','')::uuid[] ELSE ARRAY[nullif(current_setting(''arka.farm_id'',true),'''')::uuid] END))',policy.policyname,policy.tablename);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION refresh_animal_state_query() FROM PUBLIC,arka_reader;
REVOKE ALL ON FUNCTION refresh_animal_state_query_base(timestamptz) FROM PUBLIC,arka_reader;
REVOKE ALL ON FUNCTION refresh_animal_rule_values(timestamptz,timestamptz) FROM PUBLIC,arka_reader;
REVOKE ALL ON FUNCTION invalidate_animal_rule_values() FROM PUBLIC,arka_reader;
REVOKE ALL ON FUNCTION validate_rule_fact_links() FROM PUBLIC,arka_reader;
