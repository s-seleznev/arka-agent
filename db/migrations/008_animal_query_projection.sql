CREATE TABLE animal_state_query AS
SELECT * FROM animal_state_current WITH NO DATA;

ALTER TABLE animal_state_query
  ADD PRIMARY KEY (farm_id, animal_id);

CREATE INDEX animal_state_query_identifier_idx
  ON animal_state_query (farm_id, primary_identifier, animal_id);
CREATE INDEX animal_state_query_status_idx
  ON animal_state_query (farm_id, status_code, animal_id);
CREATE INDEX animal_state_query_group_idx
  ON animal_state_query (farm_id, group_code, animal_id);
CREATE INDEX animal_state_query_pregnancy_idx
  ON animal_state_query (farm_id, is_pregnant, animal_id);
CREATE INDEX animal_state_query_milk_idx
  ON animal_state_query (farm_id, last_milk_kg, animal_id);

ALTER TABLE animal_state_query ENABLE ROW LEVEL SECURITY;
CREATE POLICY animal_state_query_isolation ON animal_state_query
  FOR SELECT TO arka_reader
  USING (farm_id = nullif(current_setting('arka.farm_id', true), '')::uuid);

GRANT SELECT ON animal_state_query TO arka_reader;

CREATE FUNCTION refresh_animal_state_query() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  inserted_rows bigint;
BEGIN
  TRUNCATE animal_state_query;
  INSERT INTO animal_state_query SELECT * FROM animal_state_current;
  GET DIAGNOSTICS inserted_rows = ROW_COUNT;
  RETURN inserted_rows;
END;
$$;

REVOKE ALL ON FUNCTION refresh_animal_state_query() FROM PUBLIC;
