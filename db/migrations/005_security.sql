DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arka_reader') THEN
    CREATE ROLE arka_reader NOLOGIN;
  END IF;
END;
$$;

GRANT USAGE ON SCHEMA public TO arka_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO arka_reader;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO arka_reader;

ALTER TABLE farm ENABLE ROW LEVEL SECURITY;
CREATE POLICY farm_isolation ON farm FOR SELECT TO arka_reader
  USING (id = nullif(current_setting('arka.farm_id', true), '')::uuid);

DO $$
DECLARE
  table_name text;
BEGIN
  FOR table_name IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'farm_id'
      AND t.table_type = 'BASE TABLE'
      AND c.table_name <> 'farm'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO arka_reader '
      'USING (farm_id IS NULL OR farm_id = nullif(current_setting(''arka.farm_id'', true), '''')::uuid)',
      table_name || '_isolation', table_name
    );
  END LOOP;
END;
$$;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO arka_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO arka_reader;
