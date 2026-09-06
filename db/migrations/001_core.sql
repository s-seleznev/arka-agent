CREATE TABLE farm (
  id uuid PRIMARY KEY,
  external_id text,
  name text NOT NULL,
  timezone text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (external_id)
);

CREATE TABLE farm_access (
  farm_id uuid NOT NULL REFERENCES farm(id),
  subject_id text NOT NULL,
  role text NOT NULL CHECK (role IN (
    'OWNER', 'MANAGER', 'ZOOTECHNICIAN', 'VET',
    'INSEMINATOR', 'READER', 'IMPORT_SERVICE'
  )),
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  PRIMARY KEY (farm_id, subject_id, valid_from),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE TABLE unit_definition (
  code text PRIMARY KEY,
  dimension text NOT NULL,
  name text NOT NULL,
  factor_to_base numeric NOT NULL DEFAULT 1 CHECK (factor_to_base > 0)
);

CREATE TABLE farm_group (
  id uuid PRIMARY KEY,
  farm_id uuid NOT NULL REFERENCES farm(id),
  code text NOT NULL,
  name text NOT NULL,
  group_type text NOT NULL,
  is_hospital boolean NOT NULL DEFAULT false,
  is_milking boolean NOT NULL DEFAULT false,
  is_lactation_group boolean NOT NULL DEFAULT false,
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  UNIQUE (id, farm_id),
  UNIQUE (farm_id, code, valid_from),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE TABLE animal_status_type (
  id uuid PRIMARY KEY,
  farm_id uuid REFERENCES farm(id),
  code text NOT NULL,
  name text NOT NULL,
  category text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  valid_from timestamptz NOT NULL DEFAULT '2020-01-01Z',
  valid_to timestamptz,
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE UNIQUE INDEX animal_status_system_code_uq
  ON animal_status_type(code, valid_from) WHERE farm_id IS NULL;
CREATE UNIQUE INDEX animal_status_farm_code_uq
  ON animal_status_type(farm_id, code, valid_from) WHERE farm_id IS NOT NULL;

CREATE TABLE disease_definition (
  id uuid PRIMARY KEY,
  farm_id uuid REFERENCES farm(id),
  code text NOT NULL,
  name text NOT NULL,
  category text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  valid_from timestamptz NOT NULL DEFAULT '2020-01-01Z',
  valid_to timestamptz,
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE UNIQUE INDEX disease_system_code_uq
  ON disease_definition(code, valid_from) WHERE farm_id IS NULL;
CREATE UNIQUE INDEX disease_farm_code_uq
  ON disease_definition(farm_id, code, valid_from) WHERE farm_id IS NOT NULL;

CREATE TABLE product_definition (
  id uuid PRIMARY KEY,
  farm_id uuid REFERENCES farm(id),
  code text NOT NULL,
  name text NOT NULL,
  product_type text NOT NULL CHECK (product_type IN ('DRUG', 'VACCINE', 'OTHER')),
  dose_unit_code text REFERENCES unit_definition(code),
  default_withdrawal_hours integer CHECK (default_withdrawal_hours IS NULL OR default_withdrawal_hours >= 0),
  is_active boolean NOT NULL DEFAULT true,
  valid_from timestamptz NOT NULL DEFAULT '2020-01-01Z',
  valid_to timestamptz,
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE UNIQUE INDEX product_system_code_uq
  ON product_definition(code, valid_from) WHERE farm_id IS NULL;
CREATE UNIQUE INDEX product_farm_code_uq
  ON product_definition(farm_id, code, valid_from) WHERE farm_id IS NOT NULL;

CREATE TABLE procedure_definition (
  id uuid PRIMARY KEY,
  farm_id uuid REFERENCES farm(id),
  code text NOT NULL,
  name text NOT NULL,
  category text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  valid_from timestamptz NOT NULL DEFAULT '2020-01-01Z',
  valid_to timestamptz,
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE UNIQUE INDEX procedure_system_code_uq
  ON procedure_definition(code, valid_from) WHERE farm_id IS NULL;
CREATE UNIQUE INDEX procedure_farm_code_uq
  ON procedure_definition(farm_id, code, valid_from) WHERE farm_id IS NOT NULL;

CREATE TABLE protocol_definition (
  id uuid PRIMARY KEY,
  farm_id uuid REFERENCES farm(id),
  code text NOT NULL,
  name text NOT NULL,
  category text NOT NULL CHECK (category IN ('REPRODUCTION', 'TREATMENT', 'PREVENTION')),
  version integer NOT NULL CHECK (version > 0),
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  UNIQUE (id, farm_id),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE UNIQUE INDEX protocol_system_version_uq
  ON protocol_definition(code, version) WHERE farm_id IS NULL;
CREATE UNIQUE INDEX protocol_farm_version_uq
  ON protocol_definition(farm_id, code, version) WHERE farm_id IS NOT NULL;

CREATE TABLE protocol_step_definition (
  id uuid PRIMARY KEY,
  protocol_id uuid NOT NULL REFERENCES protocol_definition(id),
  step_code text NOT NULL,
  position integer NOT NULL CHECK (position > 0),
  offset_hours integer NOT NULL CHECK (offset_hours >= 0),
  action_code text NOT NULL,
  UNIQUE (protocol_id, step_code),
  UNIQUE (protocol_id, position)
);

CREATE TABLE farm_rule (
  id uuid PRIMARY KEY,
  farm_id uuid NOT NULL REFERENCES farm(id),
  code text NOT NULL,
  value_numeric numeric NOT NULL,
  unit_code text NOT NULL REFERENCES unit_definition(code),
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  source text NOT NULL,
  UNIQUE (farm_id, code, valid_from),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE TABLE animal (
  id uuid PRIMARY KEY,
  farm_id uuid NOT NULL REFERENCES farm(id),
  name text,
  sex text NOT NULL CHECK (sex IN ('FEMALE', 'MALE', 'UNKNOWN')),
  breed_code text,
  birth_date date NOT NULL,
  origin text NOT NULL CHECK (origin IN ('BORN_ON_FARM', 'PURCHASED', 'IMPORTED', 'UNKNOWN')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (id, farm_id)
);

CREATE INDEX animal_farm_birth_idx ON animal(farm_id, birth_date);

CREATE TABLE animal_relation (
  id uuid PRIMARY KEY,
  farm_id uuid NOT NULL REFERENCES farm(id),
  animal_id uuid NOT NULL,
  related_animal_id uuid,
  relation_type text NOT NULL CHECK (relation_type IN ('DAM', 'SIRE', 'OFFSPRING')),
  external_related_ref text,
  confidence numeric NOT NULL DEFAULT 1 CHECK (confidence >= 0 AND confidence <= 1),
  source text NOT NULL,
  FOREIGN KEY (animal_id, farm_id) REFERENCES animal(id, farm_id),
  FOREIGN KEY (related_animal_id, farm_id) REFERENCES animal(id, farm_id),
  CHECK (related_animal_id IS NOT NULL OR external_related_ref IS NOT NULL)
);

CREATE TABLE event_type (
  id uuid PRIMARY KEY,
  farm_id uuid REFERENCES farm(id),
  code text NOT NULL,
  family text NOT NULL,
  detail_table text NOT NULL,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  is_custom boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true
);

CREATE UNIQUE INDEX event_type_system_code_uq
  ON event_type(code) WHERE farm_id IS NULL;
CREATE UNIQUE INDEX event_type_farm_code_uq
  ON event_type(farm_id, code) WHERE farm_id IS NOT NULL;

CREATE TABLE animal_event (
  id uuid PRIMARY KEY,
  farm_id uuid NOT NULL REFERENCES farm(id),
  animal_id uuid NOT NULL,
  event_type_id uuid NOT NULL REFERENCES event_type(id),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('MANUAL', 'IMPORT', 'DEVICE', 'MIGRATION', 'SIMULATION')),
  source_record_id text,
  actor_ref text,
  related_event_id uuid REFERENCES animal_event(id),
  supersedes_event_id uuid REFERENCES animal_event(id),
  voided_at timestamptz,
  comment text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (animal_id, farm_id) REFERENCES animal(id, farm_id),
  UNIQUE (id, farm_id),
  CHECK (source_type = 'MIGRATION' OR recorded_at >= occurred_at),
  CHECK (voided_at IS NULL OR voided_at >= recorded_at),
  CHECK (related_event_id IS NULL OR related_event_id <> id),
  CHECK (supersedes_event_id IS NULL OR supersedes_event_id <> id)
);

CREATE UNIQUE INDEX animal_event_source_uq
  ON animal_event(farm_id, source_type, source_record_id)
  WHERE source_record_id IS NOT NULL;
CREATE INDEX animal_event_history_idx
  ON animal_event(farm_id, animal_id, occurred_at DESC, recorded_at DESC);
CREATE INDEX animal_event_type_time_idx
  ON animal_event(farm_id, event_type_id, occurred_at DESC);

CREATE FUNCTION validate_event_tenant() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  type_farm uuid;
  related_farm uuid;
BEGIN
  SELECT farm_id INTO type_farm FROM event_type WHERE id = NEW.event_type_id;
  IF type_farm IS NOT NULL AND type_farm <> NEW.farm_id THEN
    RAISE EXCEPTION 'event type belongs to another farm';
  END IF;

  IF NEW.related_event_id IS NOT NULL THEN
    SELECT farm_id INTO related_farm FROM animal_event WHERE id = NEW.related_event_id;
    IF related_farm <> NEW.farm_id THEN
      RAISE EXCEPTION 'related event belongs to another farm';
    END IF;
  END IF;

  IF NEW.supersedes_event_id IS NOT NULL THEN
    SELECT farm_id INTO related_farm FROM animal_event WHERE id = NEW.supersedes_event_id;
    IF related_farm <> NEW.farm_id THEN
      RAISE EXCEPTION 'superseded event belongs to another farm';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER animal_event_tenant_trigger
BEFORE INSERT OR UPDATE ON animal_event
FOR EACH ROW EXECUTE FUNCTION validate_event_tenant();
