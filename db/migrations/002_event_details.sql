CREATE TABLE event_birth (
  event_id uuid NOT NULL,
  farm_id uuid NOT NULL,
  birth_weight_kg numeric CHECK (birth_weight_kg > 0),
  birth_order smallint CHECK (birth_order > 0),
  viability text CHECK (viability IN ('ALIVE', 'STILLBORN', 'UNKNOWN')),
  PRIMARY KEY (event_id, farm_id),
  FOREIGN KEY (event_id, farm_id) REFERENCES animal_event(id, farm_id)
);

CREATE TABLE event_arrival (
  event_id uuid NOT NULL,
  farm_id uuid NOT NULL,
  source_kind text NOT NULL,
  previous_farm_ref text,
  PRIMARY KEY (event_id, farm_id),
  FOREIGN KEY (event_id, farm_id) REFERENCES animal_event(id, farm_id)
);

CREATE TABLE event_group_change (
  event_id uuid NOT NULL,
  farm_id uuid NOT NULL,
  previous_group_id uuid,
  new_group_id uuid NOT NULL,
  reason text,
  PRIMARY KEY (event_id, farm_id),
  FOREIGN KEY (event_id, farm_id) REFERENCES animal_event(id, farm_id),
  FOREIGN KEY (previous_group_id, farm_id) REFERENCES farm_group(id, farm_id),
  FOREIGN KEY (new_group_id, farm_id) REFERENCES farm_group(id, farm_id)
);

CREATE TABLE event_status_change (
  event_id uuid NOT NULL,
  farm_id uuid NOT NULL,
  previous_status_id uuid REFERENCES animal_status_type(id),
  new_status_id uuid NOT NULL REFERENCES animal_status_type(id),
  reason text,
  PRIMARY KEY (event_id, farm_id),
  FOREIGN KEY (event_id, farm_id) REFERENCES animal_event(id, farm_id)
);

CREATE TABLE event_identifier_change (
  event_id uuid NOT NULL,
  farm_id uuid NOT NULL,
  identifier_type text NOT NULL CHECK (identifier_type IN (
    'INVENTORY_NUMBER', 'EAR_TAG', 'CHIP', 'COLLAR',
    'TRANSPONDER', 'HARRIOT', 'EXTERNAL_ID'
  )),
  identifier_value text NOT NULL,
  action text NOT NULL CHECK (action IN ('ASSIGNED', 'REMOVED')),
  is_primary boolean NOT NULL DEFAULT false,
  related_assignment_event_id uuid REFERENCES animal_event(id),
  PRIMARY KEY (event_id, farm_id),
  FOREIGN KEY (event_id, farm_id) REFERENCES animal_event(id, farm_id),
  CHECK (
    (action = 'ASSIGNED' AND related_assignment_event_id IS NULL) OR
    (action = 'REMOVED' AND related_assignment_event_id IS NOT NULL)
  )
);

CREATE INDEX event_identifier_lookup_idx
  ON event_identifier_change(farm_id, identifier_type, identifier_value, action);

CREATE TABLE event_archive (
  event_id uuid NOT NULL,
  farm_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('ARCHIVED', 'RESTORED')),
  reason text,
  PRIMARY KEY (event_id, farm_id),
  FOREIGN KEY (event_id, farm_id) REFERENCES animal_event(id, farm_id)
);

CREATE TABLE event_exit (
  event_id uuid NOT NULL,
  farm_id uuid NOT NULL,
  exit_type text NOT NULL CHECK (exit_type IN ('SOLD', 'CULLED', 'DIED')),
  reason text,
  counterparty text,
  amount numeric CHECK (amount IS NULL OR amount >= 0),
  PRIMARY KEY (event_id, farm_id),
  FOREIGN KEY (event_id, farm_id) REFERENCES animal_event(id, farm_id)
);

CREATE TABLE event_note (
  event_id uuid NOT NULL,
  farm_id uuid NOT NULL,
  note_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('ADDED', 'UPDATED', 'REMOVED')),
  category text,
  note_text text,
  previous_note_event_id uuid REFERENCES animal_event(id),
  PRIMARY KEY (event_id, farm_id),
  FOREIGN KEY (event_id, farm_id) REFERENCES animal_event(id, farm_id),
  CHECK (action = 'REMOVED' OR note_text IS NOT NULL)
);

CREATE TABLE event_staff_assignment (
  event_id uuid NOT NULL,
  farm_id uuid NOT NULL,
  subject_id text NOT NULL,
  assignment_role text NOT NULL,
  action text NOT NULL CHECK (action IN ('ASSIGNED', 'UNASSIGNED')),
  related_assignment_event_id uuid REFERENCES animal_event(id),
  PRIMARY KEY (event_id, farm_id),
  FOREIGN KEY (event_id, farm_id) REFERENCES animal_event(id, farm_id)
);

CREATE TABLE event_insurance (
  event_id uuid NOT NULL,
  farm_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('STARTED', 'ENDED')),
  provider text,
  policy_number text,
  valid_until date,
  related_start_event_id uuid REFERENCES animal_event(id),
  reason text,
  PRIMARY KEY (event_id, farm_id),
  FOREIGN KEY (event_id, farm_id) REFERENCES animal_event(id, farm_id)
);

CREATE TABLE event_heat (
  event_id uuid NOT NULL,
  farm_id uuid NOT NULL,
  detection_method text,
  intensity smallint CHECK (intensity BETWEEN 1 AND 5),
  PRIMARY KEY (event_id, farm_id),
  FOREIGN KEY (event_id, farm_id) REFERENCES animal_event(id, farm_id)
);

CREATE TABLE event_insemination (
  event_id uuid NOT NULL,
  farm_id uuid NOT NULL,
  bull_ref text NOT NULL,
  bull_registration_number text,
  semen_batch text,
  dose numeric CHECK (dose IS NULL OR dose > 0),
  method text,
  technician_ref text,
  scheme_code text,
  PRIMARY KEY (event_id, farm_id),
  FOREIGN KEY (event_id, farm_id) REFERENCES animal_event(id, farm_id)
);

CREATE TABLE event_pregnancy_check (
  event_id uuid NOT NULL,
  farm_id uuid NOT NULL,
  insemination_event_id uuid REFERENCES animal_event(id),
  method text NOT NULL,
  result text NOT NULL CHECK (result IN ('PREGNANT', 'NOT_PREGNANT', 'INCONCLUSIVE')),
  gestation_days integer CHECK (gestation_days IS NULL OR gestation_days >= 0),
  PRIMARY KEY (event_id, farm_id),
  FOREIGN KEY (event_id, farm_id) REFERENCES animal_event(id, farm_id)
);

CREATE TABLE event_pregnancy_loss (
  event_id uuid NOT NULL,
  farm_id uuid NOT NULL,
  pregnancy_check_event_id uuid REFERENCES animal_event(id),
  loss_type text NOT NULL,
  reason text,
  confirmation_method text,
  PRIMARY KEY (event_id, farm_id),
  FOREIGN KEY (event_id, farm_id) REFERENCES animal_event(id, farm_id)
);

CREATE TABLE event_dry_off (
  event_id uuid NOT NULL,
  farm_id uuid NOT NULL,
  pregnancy_check_event_id uuid REFERENCES animal_event(id),
  method text,
  reason text NOT NULL,
  PRIMARY KEY (event_id, farm_id),
  FOREIGN KEY (event_id, farm_id) REFERENCES animal_event(id, farm_id)
);

CREATE TABLE event_calving (
  event_id uuid NOT NULL,
  farm_id uuid NOT NULL,
  difficulty smallint CHECK (difficulty BETWEEN 1 AND 5),
  offspring_count smallint NOT NULL CHECK (offspring_count >= 0),
  live_offspring_count smallint NOT NULL CHECK (live_offspring_count >= 0),
  complications text,
  PRIMARY KEY (event_id, farm_id),
  FOREIGN KEY (event_id, farm_id) REFERENCES animal_event(id, farm_id),
  CHECK (live_offspring_count <= offspring_count)
);

CREATE TABLE event_calving_offspring (
  calving_event_id uuid NOT NULL,
  farm_id uuid NOT NULL,
  ordinal smallint NOT NULL CHECK (ordinal > 0),
  animal_id uuid,
  sex text NOT NULL CHECK (sex IN ('FEMALE', 'MALE', 'UNKNOWN')),
  outcome text NOT NULL CHECK (outcome IN ('ALIVE', 'STILLBORN', 'UNKNOWN')),
  birth_weight_kg numeric CHECK (birth_weight_kg IS NULL OR birth_weight_kg > 0),
  PRIMARY KEY (calving_event_id, farm_id, ordinal),
  FOREIGN KEY (calving_event_id, farm_id) REFERENCES event_calving(event_id, farm_id),
  FOREIGN KEY (animal_id, farm_id) REFERENCES animal(id, farm_id)
);

CREATE TABLE event_milking (
  event_id uuid NOT NULL,
  farm_id uuid NOT NULL,
  session_code text NOT NULL,
  milk_kg numeric NOT NULL CHECK (milk_kg >= 0),
  duration_seconds integer CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  device_ref text,
  PRIMARY KEY (event_id, farm_id),
  FOREIGN KEY (event_id, farm_id) REFERENCES animal_event(id, farm_id)
);

CREATE TABLE event_daily_milk (
  event_id uuid NOT NULL,
  farm_id uuid NOT NULL,
  farm_date date NOT NULL,
  milk_kg numeric NOT NULL CHECK (milk_kg >= 0),
  milking_count smallint CHECK (milking_count IS NULL OR milking_count >= 0),
  PRIMARY KEY (event_id, farm_id),
  FOREIGN KEY (event_id, farm_id) REFERENCES animal_event(id, farm_id)
);

CREATE TABLE event_milk_test (
  event_id uuid NOT NULL,
  farm_id uuid NOT NULL,
  milk_kg numeric CHECK (milk_kg IS NULL OR milk_kg >= 0),
  fat_percent numeric CHECK (fat_percent IS NULL OR fat_percent BETWEEN 0 AND 100),
  protein_percent numeric CHECK (protein_percent IS NULL OR protein_percent BETWEEN 0 AND 100),
  somatic_cells integer CHECK (somatic_cells IS NULL OR somatic_cells >= 0),
  urea numeric CHECK (urea IS NULL OR urea >= 0),
  PRIMARY KEY (event_id, farm_id),
  FOREIGN KEY (event_id, farm_id) REFERENCES animal_event(id, farm_id)
);

CREATE TABLE event_measurement (
  event_id uuid NOT NULL,
  farm_id uuid NOT NULL,
  measurement_code text NOT NULL,
  value_numeric numeric NOT NULL,
  unit_code text NOT NULL REFERENCES unit_definition(code),
  method text,
  device_ref text,
  PRIMARY KEY (event_id, farm_id),
  FOREIGN KEY (event_id, farm_id) REFERENCES animal_event(id, farm_id)
);

CREATE TABLE event_health_observation (
  event_id uuid NOT NULL,
  farm_id uuid NOT NULL,
  procedure_id uuid REFERENCES procedure_definition(id),
  observation_code text NOT NULL,
  body_location text,
  result text,
  severity smallint CHECK (severity IS NULL OR severity BETWEEN 1 AND 5),
  PRIMARY KEY (event_id, farm_id),
  FOREIGN KEY (event_id, farm_id) REFERENCES animal_event(id, farm_id)
);

CREATE TABLE event_diagnosis (
  event_id uuid NOT NULL,
  farm_id uuid NOT NULL,
  disease_id uuid NOT NULL REFERENCES disease_definition(id),
  diagnosis_status text NOT NULL CHECK (diagnosis_status IN ('SUSPECTED', 'CONFIRMED')),
  severity smallint CHECK (severity IS NULL OR severity BETWEEN 1 AND 5),
  body_location text,
  PRIMARY KEY (event_id, farm_id),
  FOREIGN KEY (event_id, farm_id) REFERENCES animal_event(id, farm_id)
);

CREATE INDEX event_diagnosis_disease_idx ON event_diagnosis(farm_id, disease_id);

CREATE TABLE event_diagnosis_resolution (
  event_id uuid NOT NULL,
  farm_id uuid NOT NULL,
  diagnosis_event_id uuid NOT NULL REFERENCES animal_event(id),
  result text NOT NULL,
  reason text,
  PRIMARY KEY (event_id, farm_id),
  FOREIGN KEY (event_id, farm_id) REFERENCES animal_event(id, farm_id)
);

CREATE TABLE event_treatment (
  event_id uuid NOT NULL,
  farm_id uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES product_definition(id),
  dose numeric NOT NULL CHECK (dose > 0),
  unit_code text NOT NULL REFERENCES unit_definition(code),
  administration_route text,
  performer_ref text,
  PRIMARY KEY (event_id, farm_id),
  FOREIGN KEY (event_id, farm_id) REFERENCES animal_event(id, farm_id)
);

CREATE TABLE event_vaccination (
  event_id uuid NOT NULL,
  farm_id uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES product_definition(id),
  dose numeric NOT NULL CHECK (dose > 0),
  unit_code text NOT NULL REFERENCES unit_definition(code),
  batch_number text,
  administration_route text,
  PRIMARY KEY (event_id, farm_id),
  FOREIGN KEY (event_id, farm_id) REFERENCES animal_event(id, farm_id)
);

CREATE TABLE event_hoof_procedure (
  event_id uuid NOT NULL,
  farm_id uuid NOT NULL,
  procedure_id uuid NOT NULL REFERENCES procedure_definition(id),
  limb text,
  result text,
  PRIMARY KEY (event_id, farm_id),
  FOREIGN KEY (event_id, farm_id) REFERENCES animal_event(id, farm_id)
);

CREATE TABLE event_withdrawal_start (
  event_id uuid NOT NULL,
  farm_id uuid NOT NULL,
  reason text NOT NULL,
  expected_end_at timestamptz,
  PRIMARY KEY (event_id, farm_id),
  FOREIGN KEY (event_id, farm_id) REFERENCES animal_event(id, farm_id)
);

CREATE TABLE event_withdrawal_end (
  event_id uuid NOT NULL,
  farm_id uuid NOT NULL,
  withdrawal_start_event_id uuid NOT NULL REFERENCES animal_event(id),
  actual_end_at timestamptz NOT NULL,
  reason text,
  PRIMARY KEY (event_id, farm_id),
  FOREIGN KEY (event_id, farm_id) REFERENCES animal_event(id, farm_id)
);

CREATE TABLE event_protocol_assignment (
  event_id uuid NOT NULL,
  farm_id uuid NOT NULL,
  protocol_id uuid NOT NULL REFERENCES protocol_definition(id),
  purpose text,
  planned_start_at timestamptz,
  PRIMARY KEY (event_id, farm_id),
  FOREIGN KEY (event_id, farm_id) REFERENCES animal_event(id, farm_id)
);

CREATE INDEX event_protocol_assignment_idx ON event_protocol_assignment(farm_id, protocol_id);

CREATE TABLE event_protocol_step (
  event_id uuid NOT NULL,
  farm_id uuid NOT NULL,
  assignment_event_id uuid NOT NULL REFERENCES animal_event(id),
  step_definition_id uuid NOT NULL REFERENCES protocol_step_definition(id),
  planned_at timestamptz,
  completed_at timestamptz NOT NULL,
  result text,
  PRIMARY KEY (event_id, farm_id),
  FOREIGN KEY (event_id, farm_id) REFERENCES animal_event(id, farm_id)
);

CREATE TABLE event_protocol_completion (
  event_id uuid NOT NULL,
  farm_id uuid NOT NULL,
  assignment_event_id uuid NOT NULL REFERENCES animal_event(id),
  result text,
  PRIMARY KEY (event_id, farm_id),
  FOREIGN KEY (event_id, farm_id) REFERENCES animal_event(id, farm_id)
);

CREATE TABLE event_protocol_cancellation (
  event_id uuid NOT NULL,
  farm_id uuid NOT NULL,
  assignment_event_id uuid NOT NULL REFERENCES animal_event(id),
  reason text NOT NULL,
  PRIMARY KEY (event_id, farm_id),
  FOREIGN KEY (event_id, farm_id) REFERENCES animal_event(id, farm_id)
);

CREATE FUNCTION validate_detail_table() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  expected_table text;
BEGIN
  SELECT et.detail_table INTO expected_table
  FROM animal_event ae
  JOIN event_type et ON et.id = ae.event_type_id
  WHERE ae.id = NEW.event_id AND ae.farm_id = NEW.farm_id;

  IF expected_table IS DISTINCT FROM TG_TABLE_NAME THEN
    RAISE EXCEPTION 'event expects detail table %, got %', expected_table, TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'event_birth', 'event_arrival', 'event_group_change', 'event_status_change',
    'event_identifier_change', 'event_archive', 'event_exit', 'event_note',
    'event_staff_assignment', 'event_insurance', 'event_heat', 'event_insemination',
    'event_pregnancy_check', 'event_pregnancy_loss', 'event_dry_off', 'event_calving',
    'event_milking', 'event_daily_milk', 'event_milk_test', 'event_measurement',
    'event_health_observation', 'event_diagnosis', 'event_diagnosis_resolution',
    'event_treatment', 'event_vaccination', 'event_hoof_procedure',
    'event_withdrawal_start', 'event_withdrawal_end', 'event_protocol_assignment',
    'event_protocol_step', 'event_protocol_completion', 'event_protocol_cancellation'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_validate BEFORE INSERT OR UPDATE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION validate_detail_table()',
      table_name, table_name
    );
  END LOOP;
END;
$$;

CREATE FUNCTION validate_event_has_detail() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  expected_table text;
  detail_exists boolean;
BEGIN
  SELECT detail_table INTO expected_table FROM event_type WHERE id = NEW.event_type_id;
  EXECUTE format(
    'SELECT EXISTS (SELECT 1 FROM %I WHERE event_id = $1 AND farm_id = $2)',
    expected_table
  ) INTO detail_exists USING NEW.id, NEW.farm_id;

  IF NOT detail_exists THEN
    RAISE EXCEPTION 'missing % details for event %', expected_table, NEW.id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER animal_event_detail_required
AFTER INSERT OR UPDATE OF event_type_id ON animal_event
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_event_has_detail();
