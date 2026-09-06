CREATE TABLE animal_state_query_snapshot (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision bigint NOT NULL DEFAULT 0,
  refreshed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO animal_state_query_snapshot (singleton)
VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

CREATE FUNCTION bump_animal_state_query_snapshot() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE animal_state_query_snapshot
  SET revision = revision + 1,
      refreshed_at = clock_timestamp()
  WHERE singleton;
  RETURN NULL;
END;
$$;

CREATE TRIGGER animal_state_query_snapshot_trigger
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON animal_state_query
FOR EACH STATEMENT EXECUTE FUNCTION bump_animal_state_query_snapshot();

GRANT SELECT ON animal_state_query_snapshot TO arka_reader;
REVOKE ALL ON FUNCTION bump_animal_state_query_snapshot() FROM PUBLIC;
