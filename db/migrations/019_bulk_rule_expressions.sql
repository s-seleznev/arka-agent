-- Batch only a closed validated EVENT_DATE/EVENT_VALUE family. Other ASTs use the interpreter.
CREATE FUNCTION rule_batch_asts(p_as_of timestamptz)
RETURNS TABLE(farm_id uuid,expression_key text,ast jsonb) LANGUAGE sql STABLE AS $$
 WITH nodes AS (
 SELECT DISTINCT f.id AS farm_id,node-ARRAY['_definitionId','_definitionVersion','_formulaVersion','_unit'] AS ast
 FROM farm f CROSS JOIN LATERAL jsonb_path_query(rule_field_registry(f.id,p_as_of),'$.** ? (@.op == "EVENT_DATE" || @.op == "EVENT_VALUE")') node
 ) SELECT n.farm_id,md5(n.ast::text),n.ast FROM nodes n JOIN rule_event_source es ON es.event_code=n.ast->>'event'
 WHERE coalesce(n.ast->>'scope','LIFETIME') IN('LIFETIME','CURRENT_LACTATION','PREVIOUS_LACTATION')
 AND coalesce(upper(n.ast->>'order'),'DESC') IN('ASC','DESC')
 AND coalesce((n.ast->>'position')::integer,1) BETWEEN 1 AND 10000
 AND jsonb_typeof(coalesce(n.ast->'where','{}'::jsonb))='object'
 AND length(coalesce(n.ast->'where','{}'::jsonb)::text)<=8192
 AND (n.ast->>'op'='EVENT_DATE' OR n.ast->>'value'=ANY(es.allowed_columns))
 AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys(coalesce(n.ast->'where','{}'::jsonb))k WHERE NOT(k=ANY(es.allowed_columns)));
$$;
CREATE FUNCTION rule_batch_event_values(p_as_of timestamptz,p_knowledge timestamptz,p_animal_id uuid DEFAULT NULL)
RETURNS TABLE(animal_id uuid,farm_id uuid,expression_values jsonb) LANGUAGE sql STABLE SET enable_nestloop=off AS $$
 WITH asts AS MATERIALIZED(SELECT * FROM rule_batch_asts(p_as_of)),
 records AS MATERIALIZED(
 SELECT b.animal_id,b.farm_id,b.event_code,r.* FROM rule_bulk_event_contexts(p_as_of,p_knowledge,p_animal_id)b
 CROSS JOIN LATERAL jsonb_to_recordset(b.records)r(id uuid,occurred_at timestamptz,recorded_at timestamptz,details jsonb)
 ), calving_rank AS (
 SELECT e.animal_id,e.occurred_at,row_number()OVER(PARTITION BY e.animal_id ORDER BY e.occurred_at DESC,e.recorded_at DESC,e.id DESC)n
 FROM effective_animal_events(p_as_of,p_knowledge)e WHERE e.event_code='CALVED' AND (p_animal_id IS NULL OR e.animal_id=p_animal_id)
 ), calvings AS MATERIALIZED(SELECT animal_id,max(occurred_at)FILTER(WHERE n=1) current_start,max(occurred_at)FILTER(WHERE n=2) previous_start FROM calving_rank WHERE n<=2 GROUP BY animal_id), ranked AS (
 SELECT r.animal_id,r.farm_id,a.expression_key,a.ast,r.details,r.occurred_at,
 row_number()OVER(PARTITION BY r.animal_id,r.farm_id,a.expression_key ORDER BY
 CASE WHEN coalesce(upper(a.ast->>'order'),'DESC')='ASC' THEN r.occurred_at END ASC,
 CASE WHEN coalesce(upper(a.ast->>'order'),'DESC')='DESC' THEN r.occurred_at END DESC,
 CASE WHEN coalesce(upper(a.ast->>'order'),'DESC')='ASC' THEN r.recorded_at END ASC,
 CASE WHEN coalesce(upper(a.ast->>'order'),'DESC')='DESC' THEN r.recorded_at END DESC,
 CASE WHEN coalesce(upper(a.ast->>'order'),'DESC')='ASC' THEN r.id END ASC,
 CASE WHEN coalesce(upper(a.ast->>'order'),'DESC')='DESC' THEN r.id END DESC)n
 FROM records r JOIN asts a ON a.farm_id=r.farm_id AND a.ast->>'event'=r.event_code
 LEFT JOIN calvings c ON c.animal_id=r.animal_id
 WHERE r.details @> coalesce(a.ast->'where','{}'::jsonb)
 AND CASE coalesce(a.ast->>'scope','LIFETIME')
 WHEN 'CURRENT_LACTATION' THEN r.occurred_at>=c.current_start
 WHEN 'PREVIOUS_LACTATION' THEN r.occurred_at>=c.previous_start AND r.occurred_at<c.current_start ELSE true END
 ) SELECT r.animal_id,r.farm_id,jsonb_object_agg(expression_key,
 CASE WHEN ast->>'op'='EVENT_DATE' THEN to_jsonb((occurred_at AT TIME ZONE f.timezone)::date) ELSE details->(ast->>'value') END)
 FROM ranked r JOIN farm f ON f.id=r.farm_id WHERE n=coalesce((ast->>'position')::integer,1)
 GROUP BY r.animal_id,r.farm_id;
$$;
CREATE OR REPLACE FUNCTION rule_fact_contexts(p_as_of timestamptz,p_knowledge timestamptz,p_projection boolean,p_animal_id uuid)
RETURNS TABLE(animal_id uuid,farm_id uuid,context jsonb) LANGUAGE sql STABLE SET enable_nestloop=off AS $$
 WITH keys AS MATERIALIZED(SELECT farm_id,jsonb_agg(expression_key) AS value FROM rule_batch_asts(p_as_of) GROUP BY farm_id),
 values AS MATERIALIZED(SELECT * FROM rule_batch_event_values(p_as_of,p_knowledge,p_animal_id))
 SELECT b.animal_id,b.farm_id,b.context||jsonb_build_object('_cached_expression_keys',coalesce(k.value,'[]'::jsonb),'_event_expression_values',coalesce(v.expression_values,'{}'::jsonb))
 FROM rule_fact_contexts_base(p_as_of,p_knowledge,p_projection,p_animal_id)b
 LEFT JOIN keys k USING(farm_id) LEFT JOIN values v USING(animal_id,farm_id);
$$;
DO $$ DECLARE definition text; needle text:='THEN RETURN evaluate_rule_expression_events(p_ast,p_context,p_stack); END IF;'; BEGIN
 definition:=pg_get_functiondef('evaluate_rule_expression(jsonb,jsonb,text[])'::regprocedure);
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'unexpected scalar interpreter definition'; END IF;
 definition:=replace(definition,needle,$body$THEN
 IF (p_context->'_cached_expression_keys') ? md5((p_ast-ARRAY['_definitionId','_definitionVersion','_formulaVersion','_unit'])::text) THEN
  RETURN p_context->'_event_expression_values'->md5((p_ast-ARRAY['_definitionId','_definitionVersion','_formulaVersion','_unit'])::text);
 END IF;
 RETURN evaluate_rule_expression_events(p_ast,p_context,p_stack); END IF;$body$);
 EXECUTE definition;
END $$;
UPDATE animal_rule_projection_snapshot SET stale=true WHERE singleton;

-- Merge root event batch fields directly; no per-animal event interpreter dispatch.
CREATE OR REPLACE FUNCTION refresh_animal_rule_values(p_as_of timestamptz DEFAULT clock_timestamp(),p_knowledge timestamptz DEFAULT clock_timestamp()) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET enable_nestloop=off AS $$
DECLARE n bigint; fingerprint text;
BEGIN
 SELECT md5(coalesce(string_agg(f.id::text||':'||rule_field_registry(f.id,p_as_of)::text,'|' ORDER BY f.id),'')) INTO fingerprint FROM farm f;
 WITH registries AS MATERIALIZED(SELECT f.id AS farm_id,rule_field_registry(f.id,p_as_of) AS registry FROM farm f),
 entries AS MATERIALIZED(SELECT r.farm_id,k.key AS code,a.expression_key,CASE WHEN octet_length(k.value::text)<=65536 AND k.value->>'op'='CONTEXT' THEN k.value->>'key' END AS context_key,CASE WHEN octet_length(k.value::text)<=65536 AND k.value->>'op'='CUSTOM_VALUE' THEN k.value->>'fieldDefinitionId' END AS custom_key
 FROM registries r CROSS JOIN LATERAL jsonb_each(r.registry)k
 LEFT JOIN rule_batch_asts(p_as_of)a ON a.farm_id=r.farm_id AND octet_length(k.value::text)<=65536 AND a.expression_key=md5((k.value-ARRAY['_definitionId','_definitionVersion','_formulaVersion','_unit'])::text)),
 contexts AS MATERIALIZED(SELECT c.animal_id,c.farm_id,c.context||jsonb_build_object('_formula_registry',r.registry) AS context,r.registry
 FROM rule_fact_contexts(p_as_of,p_knowledge,true)c JOIN registries r USING(farm_id)),
 values AS (SELECT c.animal_id,c.farm_id,(SELECT jsonb_object_agg(k.code,coalesce(CASE WHEN k.expression_key IS NOT NULL THEN c.context->'_event_expression_values'->k.expression_key WHEN k.context_key IS NOT NULL THEN c.context->k.context_key WHEN k.custom_key IS NOT NULL THEN c.context->'_custom_values'->k.custom_key ELSE evaluate_rule_expression(jsonb_build_object('op','FIELD','code',k.code),c.context) END,'null'::jsonb)) FROM entries k WHERE k.farm_id=c.farm_id) AS value
 FROM contexts c)
 UPDATE animal_state_query s SET rule_values=v.value FROM values v WHERE (s.animal_id,s.farm_id)=(v.animal_id,v.farm_id);
 GET DIAGNOSTICS n=ROW_COUNT;
 INSERT INTO animal_rule_projection_snapshot(singleton,as_of,knowledge_at,formula_version,refreshed_at,stale)
 VALUES(true,p_as_of,p_knowledge,fingerprint,clock_timestamp(),false)
 ON CONFLICT(singleton) DO UPDATE SET as_of=excluded.as_of,knowledge_at=excluded.knowledge_at,formula_version=excluded.formula_version,refreshed_at=excluded.refreshed_at,stale=false;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION refresh_animal_rule_values(timestamptz,timestamptz) FROM PUBLIC,arka_reader;
