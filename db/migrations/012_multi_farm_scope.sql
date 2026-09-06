DROP POLICY IF EXISTS farm_isolation ON farm;
CREATE POLICY farm_isolation ON farm FOR SELECT TO arka_reader
  USING (
    id = ANY(
      CASE
        WHEN coalesce(current_setting('arka.farm_ids', true), '') <> ''
          THEN string_to_array(current_setting('arka.farm_ids', true), ',')::uuid[]
        ELSE ARRAY[nullif(current_setting('arka.farm_id', true), '')::uuid]
      END
    )
  );

DROP POLICY IF EXISTS animal_state_query_isolation ON animal_state_query;
CREATE POLICY animal_state_query_isolation ON animal_state_query
  FOR SELECT TO arka_reader
  USING (
    farm_id = ANY(
      CASE
        WHEN coalesce(current_setting('arka.farm_ids', true), '') <> ''
          THEN string_to_array(current_setting('arka.farm_ids', true), ',')::uuid[]
        ELSE ARRAY[nullif(current_setting('arka.farm_id', true), '')::uuid]
      END
    )
  );
