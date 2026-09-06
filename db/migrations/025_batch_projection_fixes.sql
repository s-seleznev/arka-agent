-- Fix batch counts, deterministic DESC ties, and exact closed WINDOW bounds.
-- This is a corrective migration for 023; it preserves the interpreter WINDOW contract. to the already-supported EVENT_COUNT and
-- EVENT_AGGREGATE operators. WINDOW is admitted only for the canonical
-- as_of +/- literal-day shape used by process fields.
CREATE OR REPLACE FUNCTION rule_batch_asts(p_as_of timestamptz)
RETURNS TABLE(farm_id uuid,expression_key text,ast jsonb) LANGUAGE sql STABLE AS $$
 WITH nodes AS (
  SELECT DISTINCT f.id AS farm_id,
         node-ARRAY['_definitionId','_definitionVersion','_formulaVersion','_unit'] AS ast
  FROM farm f
  CROSS JOIN LATERAL jsonb_path_query(rule_field_registry(f.id,p_as_of),'$.** ? (@.op == "EVENT_DATE" || @.op == "EVENT_VALUE" || @.op == "EVENT_COUNT" || @.op == "EVENT_AGGREGATE")') node
 )
 SELECT n.farm_id,md5(n.ast::text),n.ast
 FROM nodes n JOIN rule_event_source es ON es.event_code=n.ast->>'event'
 WHERE coalesce(n.ast->>'scope','LIFETIME') IN('LIFETIME','CURRENT_LACTATION','PREVIOUS_LACTATION','WINDOW')
   AND coalesce(upper(n.ast->>'order'),'DESC') IN('ASC','DESC')
   AND coalesce((n.ast->>'position')::integer,1) BETWEEN 1 AND 10000
   AND jsonb_typeof(coalesce(n.ast->'where','{}'::jsonb))='object'
   AND length(coalesce(n.ast->'where','{}'::jsonb)::text)<=8192
   AND (n.ast->>'op' IN('EVENT_DATE','EVENT_COUNT') OR n.ast->>'value'=ANY(es.allowed_columns))
   AND (n.ast->>'op' <> 'EVENT_AGGREGATE' OR upper(coalesce(n.ast->>'aggregate','LATEST')) IN('SUM','AVG','MIN','MAX'))
   AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys(coalesce(n.ast->'where','{}'::jsonb)) k WHERE NOT(k=ANY(es.allowed_columns)))
   AND (coalesce(n.ast->>'scope','LIFETIME') <> 'WINDOW' OR (
     n.ast->'from'->>'op'='ADD_DAYS' AND n.ast->'from'->'left'->>'op'='CONTEXT'
     AND n.ast->'from'->'left'->>'key'='as_of' AND jsonb_typeof(n.ast->'from'->'right'->'value')='number'
     AND n.ast->'to'->>'op'='ADD_DAYS' AND n.ast->'to'->'left'->>'op'='CONTEXT'
     AND n.ast->'to'->'left'->>'key'='as_of' AND n.ast->'to'->'right'->>'op'='LITERAL'
     AND jsonb_typeof(n.ast->'to'->'right'->'value')='number'
   ));
$$;

CREATE OR REPLACE FUNCTION rule_batch_event_values(p_as_of timestamptz,p_knowledge timestamptz,p_animal_id uuid DEFAULT NULL)
RETURNS TABLE(animal_id uuid,farm_id uuid,expression_values jsonb) LANGUAGE sql STABLE SET enable_nestloop=off AS $$
 WITH asts AS MATERIALIZED(SELECT * FROM rule_batch_asts(p_as_of)),
 records AS MATERIALIZED(
  SELECT b.animal_id,b.farm_id,b.event_code,r.*
  FROM rule_bulk_event_contexts(p_as_of,p_knowledge,p_animal_id)b
  CROSS JOIN LATERAL jsonb_to_recordset(b.records) r(id uuid,occurred_at timestamptz,recorded_at timestamptz,details jsonb)
 ),
 calving_rank AS (
  SELECT e.animal_id,e.occurred_at,row_number() OVER(PARTITION BY e.animal_id ORDER BY e.occurred_at DESC,e.recorded_at DESC,e.id DESC) n
  FROM effective_animal_events(p_as_of,p_knowledge)e
  WHERE e.event_code='CALVED' AND (p_animal_id IS NULL OR e.animal_id=p_animal_id)
 ),
 calvings AS MATERIALIZED(
  SELECT animal_id,max(occurred_at) FILTER(WHERE n=1) current_start,max(occurred_at) FILTER(WHERE n=2) previous_start
  FROM calving_rank WHERE n<=2 GROUP BY animal_id
 ),
 matched AS MATERIALIZED(
  SELECT r.animal_id,r.farm_id,a.expression_key,r.details,r.occurred_at,r.recorded_at,r.id
  FROM records r JOIN asts a ON a.farm_id=r.farm_id AND a.ast->>'event'=r.event_code
  LEFT JOIN calvings c ON c.animal_id=r.animal_id
  JOIN farm f ON f.id=r.farm_id
  WHERE r.details @> coalesce(a.ast->'where','{}'::jsonb)
    AND (
      CASE coalesce(a.ast->>'scope','LIFETIME')
        WHEN 'CURRENT_LACTATION' THEN r.occurred_at>=c.current_start
        WHEN 'PREVIOUS_LACTATION' THEN r.occurred_at>=c.previous_start AND r.occurred_at<c.current_start
        WHEN 'WINDOW' THEN r.occurred_at>=(((p_as_of AT TIME ZONE f.timezone)::date + (a.ast->'from'->'right'->>'value')::integer)::timestamp AT TIME ZONE f.timezone)
          AND r.occurred_at<((p_as_of AT TIME ZONE f.timezone)::date + coalesce((a.ast->'to'->'right'->>'value')::integer,0) + 1)::timestamp AT TIME ZONE f.timezone
        ELSE true
      END
    )
 ),
 ranked AS (
  SELECT m.*,a.ast,
   row_number() OVER(PARTITION BY m.animal_id,m.farm_id,m.expression_key ORDER BY
    CASE WHEN coalesce(upper(a.ast->>'order'),'DESC')='ASC' THEN m.occurred_at END ASC,
    CASE WHEN coalesce(upper(a.ast->>'order'),'DESC')='DESC' THEN m.occurred_at END DESC,
    CASE WHEN coalesce(upper(a.ast->>'order'),'DESC')='ASC' THEN m.recorded_at END ASC,
    CASE WHEN coalesce(upper(a.ast->>'order'),'DESC')='DESC' THEN m.recorded_at END DESC,
    CASE WHEN coalesce(upper(a.ast->>'order'),'DESC')='ASC' THEN m.id END ASC,
    CASE WHEN coalesce(upper(a.ast->>'order'),'DESC')='DESC' THEN m.id END DESC
   ) n
  FROM matched m JOIN asts a ON a.farm_id=m.farm_id AND a.expression_key=m.expression_key
  WHERE a.ast->>'op' IN('EVENT_DATE','EVENT_VALUE')
 ),
 selected AS (
  SELECT animal_id,farm_id,expression_key,
   CASE WHEN ranked.ast->>'op'='EVENT_DATE' THEN to_jsonb((occurred_at AT TIME ZONE f.timezone)::date) ELSE details->(ranked.ast->>'value') END value
  FROM ranked JOIN farm f ON f.id=ranked.farm_id
  WHERE n=coalesce((ranked.ast->>'position')::integer,1)
 ),
 grouped AS (
  SELECT m.animal_id,m.farm_id,m.expression_key,a.ast,
   count(*)::numeric event_count,
   CASE upper(coalesce(a.ast->>'aggregate','LATEST'))
    WHEN 'SUM' THEN sum((m.details->>(a.ast->>'value'))::numeric)
    WHEN 'AVG' THEN avg((m.details->>(a.ast->>'value'))::numeric)
    WHEN 'MIN' THEN min((m.details->>(a.ast->>'value'))::numeric)
    WHEN 'MAX' THEN max((m.details->>(a.ast->>'value'))::numeric)
   END event_value
  FROM matched m JOIN asts a ON a.farm_id=m.farm_id AND a.expression_key=m.expression_key
  WHERE a.ast->>'op'='EVENT_AGGREGATE'
  GROUP BY m.animal_id,m.farm_id,m.expression_key,a.ast
 ),
 count_asts AS (
  SELECT * FROM asts WHERE ast->>'op'='EVENT_COUNT'
 ),
 count_values AS (
  SELECT an.id animal_id,an.farm_id,a.expression_key,to_jsonb(count(m.id)) value
  FROM animal an JOIN count_asts a ON a.farm_id=an.farm_id
  LEFT JOIN matched m ON m.animal_id=an.id AND m.farm_id=an.farm_id AND m.expression_key=a.expression_key
  WHERE p_animal_id IS NULL OR an.id=p_animal_id
  GROUP BY an.id,an.farm_id,a.expression_key
 ),
 all_values AS (
  SELECT * FROM selected
  UNION ALL
  SELECT animal_id,farm_id,expression_key,CASE WHEN ast->>'op'='EVENT_COUNT' THEN to_jsonb(event_count::bigint) ELSE to_jsonb(event_value) END FROM grouped
  UNION ALL
  SELECT * FROM count_values
 )
 SELECT animal_id,farm_id,jsonb_object_agg(expression_key,value)
 FROM all_values GROUP BY animal_id,farm_id;
$$;

UPDATE animal_rule_projection_snapshot SET stale=true WHERE singleton;


-- 020 used an exclusive upper bound but encoded `to=as_of`, which the
-- interpreter expands to the current local day. Use seven completed days
-- [-7,-1], excluding today; the batch path now evaluates the same AST.
UPDATE field_definition
SET source_ast = jsonb_set(source_ast, '{to}', '{"op":"ADD_DAYS","left":{"op":"CONTEXT","key":"as_of"},"right":{"op":"LITERAL","value":-1}}'::jsonb),
    provenance = jsonb_set(provenance, '{selection}', '"farm-local dates [as_of-7, as_of-1], upper bound exclusive"'::jsonb)
WHERE code IN ('AVG_DAILY_MILK_7D','AVG_DAILY_MILK_10D') AND farm_id IS NULL;
UPDATE calculated_field cf
SET expression_ast=fd.source_ast
FROM field_definition fd
WHERE fd.id=cf.field_definition_id
  AND fd.code IN ('AVG_DAILY_MILK_7D','AVG_DAILY_MILK_10D')
  AND cf.valid_to IS NULL;
UPDATE animal_rule_projection_snapshot SET stale=true WHERE singleton;
