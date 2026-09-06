ALTER FUNCTION refresh_animal_state_query() RENAME TO refresh_animal_state_query_base;
DO $$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('refresh_animal_state_query_base()'::regprocedure);
 IF position('snapshot_at timestamptz := clock_timestamp();' IN definition)=0 THEN RAISE EXCEPTION 'unexpected base projection function: snapshot injection unavailable'; END IF;
 definition:=replace(definition,'refresh_animal_state_query_base()','refresh_animal_state_query_base(p_snapshot timestamptz)');
 definition:=replace(definition,'snapshot_at timestamptz := clock_timestamp();','snapshot_at timestamptz := p_snapshot;');
 EXECUTE definition;
END $$;
DROP FUNCTION refresh_animal_state_query_base();
REVOKE ALL ON FUNCTION refresh_animal_state_query_base(timestamptz) FROM PUBLIC,arka_reader;
CREATE FUNCTION refresh_animal_state_query() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE n bigint; snapshot_at timestamptz;
BEGIN
 snapshot_at:=clock_timestamp();
 n:=refresh_animal_state_query_base(snapshot_at);
 PERFORM refresh_animal_rule_values(snapshot_at,snapshot_at);
 UPDATE animal_rule_projection_snapshot SET stale=false WHERE singleton;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION refresh_animal_state_query() FROM PUBLIC,arka_reader;
-- Fact and registry changes make stale projections visible to the application.

CREATE FUNCTION invalidate_animal_rule_values() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN UPDATE animal_rule_projection_snapshot SET stale=true; RETURN NULL; END $$;
DO $$ DECLARE t text; BEGIN
 FOR t IN SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND (table_name LIKE 'event\_%' ESCAPE '\' OR table_name IN('animal','animal_event','calculated_field','field_definition','farm_rule','farm_group','farm')) LOOP
  EXECUTE format('CREATE TRIGGER rule_projection_invalidate AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION invalidate_animal_rule_values()',t);
 END LOOP;
END $$;
