DO $$
DECLARE
  definition text;
BEGIN
  SELECT pg_get_functiondef(
    'animal_state_at(timestamp with time zone, timestamp with time zone)'::regprocedure
  ) INTO definition;
  definition := replace(
    definition,
    'WITH effective AS MATERIALIZED',
    'WITH effective AS NOT MATERIALIZED'
  );
  EXECUTE definition;
END;
$$;

CREATE INDEX IF NOT EXISTS animal_event_supersedes_idx
  ON animal_event (supersedes_event_id)
  WHERE supersedes_event_id IS NOT NULL;
