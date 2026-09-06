CREATE TABLE field_definition (
  id uuid PRIMARY KEY,
  farm_id uuid REFERENCES farm(id),
  code text NOT NULL,
  name text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('ANIMAL', 'FARM', 'GROUP', 'EVENT')),
  value_type text NOT NULL CHECK (value_type IN (
    'TEXT', 'INTEGER', 'NUMERIC', 'BOOLEAN', 'DATE', 'TIMESTAMP', 'ENUM', 'REFERENCE'
  )),
  unit_code text REFERENCES unit_definition(code),
  reference_kind text,
  source_kind text NOT NULL CHECK (source_kind IN (
    'ANIMAL_ATTRIBUTE', 'FARM_ATTRIBUTE', 'LATEST_EVENT', 'EVENT_COUNT',
    'AGGREGATE', 'CALCULATED', 'CUSTOM_EVENT_VALUE'
  )),
  source_path text,
  is_filterable boolean NOT NULL DEFAULT true,
  is_groupable boolean NOT NULL DEFAULT false,
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  valid_from timestamptz NOT NULL DEFAULT '2020-01-01Z',
  valid_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((value_type = 'REFERENCE') = (reference_kind IS NOT NULL)),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE UNIQUE INDEX field_definition_system_code_uq
  ON field_definition(code, valid_from) WHERE farm_id IS NULL;
CREATE UNIQUE INDEX field_definition_farm_code_uq
  ON field_definition(farm_id, code, valid_from) WHERE farm_id IS NOT NULL;

CREATE TABLE field_alias (
  id uuid PRIMARY KEY,
  farm_id uuid REFERENCES farm(id),
  field_definition_id uuid NOT NULL REFERENCES field_definition(id),
  alias text NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE UNIQUE INDEX field_alias_system_uq
  ON field_alias(alias, valid_from) WHERE farm_id IS NULL;
CREATE UNIQUE INDEX field_alias_farm_uq
  ON field_alias(farm_id, alias, valid_from) WHERE farm_id IS NOT NULL;

CREATE TABLE calculated_field (
  id uuid PRIMARY KEY,
  field_definition_id uuid NOT NULL REFERENCES field_definition(id),
  version smallint NOT NULL DEFAULT 1 CHECK (version > 0),
  expression_ast jsonb NOT NULL,
  description text NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  UNIQUE (field_definition_id, version),
  CHECK (jsonb_typeof(expression_ast) = 'object'),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE TABLE calculated_field_dependency (
  calculated_field_id uuid NOT NULL REFERENCES calculated_field(id),
  depends_on_field_id uuid NOT NULL REFERENCES field_definition(id),
  PRIMARY KEY (calculated_field_id, depends_on_field_id),
  CHECK (calculated_field_id <> depends_on_field_id)
);

CREATE TABLE custom_event_value (
  event_id uuid NOT NULL,
  farm_id uuid NOT NULL,
  field_definition_id uuid NOT NULL REFERENCES field_definition(id),
  value_text text,
  value_numeric numeric,
  value_boolean boolean,
  value_date date,
  value_timestamp timestamptz,
  value_reference uuid,
  PRIMARY KEY (event_id, farm_id, field_definition_id),
  FOREIGN KEY (event_id, farm_id) REFERENCES animal_event(id, farm_id),
  CHECK (num_nonnulls(
    value_text, value_numeric, value_boolean, value_date,
    value_timestamp, value_reference
  ) = 1)
);

CREATE FUNCTION validate_custom_event_value() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  declared_type text;
  declared_farm uuid;
  actual_type text;
BEGIN
  SELECT value_type, farm_id INTO declared_type, declared_farm
  FROM field_definition WHERE id = NEW.field_definition_id;

  IF declared_farm IS NULL OR declared_farm <> NEW.farm_id THEN
    RAISE EXCEPTION 'custom event field must belong to event farm';
  END IF;

  actual_type := CASE
    WHEN NEW.value_text IS NOT NULL THEN 'TEXT'
    WHEN NEW.value_numeric IS NOT NULL THEN 'NUMERIC'
    WHEN NEW.value_boolean IS NOT NULL THEN 'BOOLEAN'
    WHEN NEW.value_date IS NOT NULL THEN 'DATE'
    WHEN NEW.value_timestamp IS NOT NULL THEN 'TIMESTAMP'
    WHEN NEW.value_reference IS NOT NULL THEN 'REFERENCE'
  END;

  IF actual_type <> declared_type
     AND NOT (actual_type = 'NUMERIC' AND declared_type = 'INTEGER'
              AND trunc(NEW.value_numeric) = NEW.value_numeric) THEN
    RAISE EXCEPTION 'field expects %, got %', declared_type, actual_type;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER custom_event_value_validate
BEFORE INSERT OR UPDATE ON custom_event_value
FOR EACH ROW EXECUTE FUNCTION validate_custom_event_value();

CREATE TRIGGER custom_event_value_detail_validate
BEFORE INSERT OR UPDATE ON custom_event_value
FOR EACH ROW EXECUTE FUNCTION validate_detail_table();

CREATE FUNCTION reject_calculated_field_cycle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  has_cycle boolean;
  target_field_id uuid;
BEGIN
  SELECT field_definition_id INTO target_field_id
  FROM calculated_field WHERE id = NEW.calculated_field_id;

  WITH RECURSIVE dependency_path(field_id) AS (
    SELECT NEW.depends_on_field_id
    UNION
    SELECT d.depends_on_field_id
    FROM dependency_path p
    JOIN calculated_field cf ON cf.field_definition_id = p.field_id
    JOIN calculated_field_dependency d ON d.calculated_field_id = cf.id
  )
  SELECT EXISTS (
    SELECT 1 FROM dependency_path WHERE field_id = target_field_id
  ) INTO has_cycle;

  IF has_cycle THEN
    RAISE EXCEPTION 'calculated field dependency cycle';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER calculated_field_dependency_cycle
BEFORE INSERT OR UPDATE ON calculated_field_dependency
FOR EACH ROW EXECUTE FUNCTION reject_calculated_field_cycle();
