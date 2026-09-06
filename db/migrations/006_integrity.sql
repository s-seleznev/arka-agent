CREATE FUNCTION validate_farm_timezone() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'unknown IANA timezone: %', NEW.timezone;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER farm_timezone_validate
BEFORE INSERT OR UPDATE OF timezone ON farm
FOR EACH ROW EXECUTE FUNCTION validate_farm_timezone();

CREATE OR REPLACE FUNCTION validate_event_tenant() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  type_farm uuid;
  type_active boolean;
  animal_birth date;
  related_farm uuid;
BEGIN
  SELECT farm_id, is_active INTO type_farm, type_active
  FROM event_type WHERE id = NEW.event_type_id;
  IF NOT FOUND OR NOT type_active THEN RAISE EXCEPTION 'unknown or inactive event type'; END IF;
  IF type_farm IS NOT NULL AND type_farm <> NEW.farm_id THEN
    RAISE EXCEPTION 'event type belongs to another farm';
  END IF;

  SELECT birth_date INTO animal_birth FROM animal
  WHERE id = NEW.animal_id AND farm_id = NEW.farm_id;
  IF animal_birth IS NULL THEN RAISE EXCEPTION 'animal belongs to another farm or does not exist'; END IF;
  IF NEW.occurred_at::date < animal_birth AND NEW.source_type <> 'MIGRATION' THEN
    RAISE EXCEPTION 'event occurs before animal birth';
  END IF;

  IF EXISTS (
    SELECT 1 FROM animal_event exited
    JOIN event_exit ee ON (ee.event_id,ee.farm_id)=(exited.id,exited.farm_id)
    WHERE exited.animal_id=NEW.animal_id AND exited.farm_id=NEW.farm_id
      AND exited.occurred_at < NEW.occurred_at
  ) AND NEW.source_type <> 'MIGRATION' THEN
    RAISE EXCEPTION 'event occurs after animal exit';
  END IF;

  IF (SELECT code FROM event_type WHERE id=NEW.event_type_id) = 'EXITED'
     AND EXISTS (
       SELECT 1 FROM animal_event later
       WHERE later.animal_id=NEW.animal_id AND later.farm_id=NEW.farm_id
         AND later.occurred_at > NEW.occurred_at
     ) AND NEW.source_type <> 'MIGRATION' THEN
    RAISE EXCEPTION 'animal already has events after this exit';
  END IF;

  IF NEW.related_event_id IS NOT NULL THEN
    SELECT farm_id INTO related_farm FROM animal_event WHERE id = NEW.related_event_id;
    IF related_farm <> NEW.farm_id THEN RAISE EXCEPTION 'related event belongs to another farm'; END IF;
  END IF;
  IF NEW.supersedes_event_id IS NOT NULL THEN
    SELECT farm_id INTO related_farm FROM animal_event WHERE id = NEW.supersedes_event_id;
    IF related_farm <> NEW.farm_id THEN RAISE EXCEPTION 'superseded event belongs to another farm'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION protect_animal_event_history() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'animal events are append-only'; END IF;
  IF OLD.voided_at IS NULL AND NEW.voided_at IS NOT NULL
     AND (to_jsonb(NEW) - 'voided_at') = (to_jsonb(OLD) - 'voided_at') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'animal events are append-only; create a superseding event';
END;
$$;

CREATE TRIGGER animal_event_history_protect
BEFORE UPDATE OR DELETE ON animal_event
FOR EACH ROW EXECUTE FUNCTION protect_animal_event_history();

CREATE FUNCTION validate_detail_catalog_reference() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  reference_id uuid;
  reference_farm uuid;
  reference_exists boolean;
BEGIN
  reference_id := (to_jsonb(NEW) ->> TG_ARGV[1])::uuid;
  IF reference_id IS NULL THEN RETURN NEW; END IF;
  EXECUTE format('SELECT farm_id, true FROM %I WHERE id=$1', TG_ARGV[0])
    INTO reference_farm, reference_exists USING reference_id;
  IF reference_exists IS DISTINCT FROM true
     OR (reference_farm IS NOT NULL AND reference_farm <> NEW.farm_id) THEN
    RAISE EXCEPTION '% reference belongs to another farm or does not exist', TG_ARGV[1];
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER status_reference_validate BEFORE INSERT OR UPDATE ON event_status_change
FOR EACH ROW EXECUTE FUNCTION validate_detail_catalog_reference('animal_status_type','new_status_id');
CREATE TRIGGER diagnosis_reference_validate BEFORE INSERT OR UPDATE ON event_diagnosis
FOR EACH ROW EXECUTE FUNCTION validate_detail_catalog_reference('disease_definition','disease_id');
CREATE TRIGGER treatment_reference_validate BEFORE INSERT OR UPDATE ON event_treatment
FOR EACH ROW EXECUTE FUNCTION validate_detail_catalog_reference('product_definition','product_id');
CREATE TRIGGER vaccination_reference_validate BEFORE INSERT OR UPDATE ON event_vaccination
FOR EACH ROW EXECUTE FUNCTION validate_detail_catalog_reference('product_definition','product_id');
CREATE TRIGGER health_procedure_reference_validate BEFORE INSERT OR UPDATE ON event_health_observation
FOR EACH ROW EXECUTE FUNCTION validate_detail_catalog_reference('procedure_definition','procedure_id');
CREATE TRIGGER hoof_procedure_reference_validate BEFORE INSERT OR UPDATE ON event_hoof_procedure
FOR EACH ROW EXECUTE FUNCTION validate_detail_catalog_reference('procedure_definition','procedure_id');
CREATE TRIGGER protocol_reference_validate BEFORE INSERT OR UPDATE ON event_protocol_assignment
FOR EACH ROW EXECUTE FUNCTION validate_detail_catalog_reference('protocol_definition','protocol_id');

CREATE FUNCTION validate_product_unit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE expected_dimension text; actual_dimension text;
BEGIN
  SELECT u.dimension INTO expected_dimension
  FROM product_definition p LEFT JOIN unit_definition u ON u.code=p.dose_unit_code
  WHERE p.id=NEW.product_id;
  SELECT dimension INTO actual_dimension FROM unit_definition WHERE code=NEW.unit_code;
  IF expected_dimension IS NOT NULL AND expected_dimension IS DISTINCT FROM actual_dimension THEN
    RAISE EXCEPTION 'dose unit has incompatible dimension';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER treatment_unit_validate BEFORE INSERT OR UPDATE ON event_treatment
FOR EACH ROW EXECUTE FUNCTION validate_product_unit();
CREATE TRIGGER vaccination_unit_validate BEFORE INSERT OR UPDATE ON event_vaccination
FOR EACH ROW EXECUTE FUNCTION validate_product_unit();

CREATE FUNCTION validate_protocol_step_membership() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE assigned_protocol uuid; step_protocol uuid;
BEGIN
  SELECT epa.protocol_id INTO assigned_protocol
  FROM event_protocol_assignment epa WHERE epa.event_id=NEW.assignment_event_id;
  SELECT protocol_id INTO step_protocol FROM protocol_step_definition WHERE id=NEW.step_definition_id;
  IF assigned_protocol IS NULL OR assigned_protocol <> step_protocol THEN
    RAISE EXCEPTION 'protocol step does not belong to assigned protocol';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER protocol_step_membership_validate
BEFORE INSERT OR UPDATE ON event_protocol_step
FOR EACH ROW EXECUTE FUNCTION validate_protocol_step_membership();

CREATE FUNCTION validate_linked_event_tenant() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  linked_id uuid;
  linked_farm uuid;
BEGIN
  linked_id := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
  IF linked_id IS NULL THEN RETURN NEW; END IF;
  SELECT farm_id INTO linked_farm FROM animal_event WHERE id=linked_id;
  IF NOT FOUND OR linked_farm <> NEW.farm_id THEN
    RAISE EXCEPTION '% belongs to another farm or does not exist', TG_ARGV[0];
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  item text[];
BEGIN
  FOREACH item SLICE 1 IN ARRAY ARRAY[
    ['event_identifier_change','related_assignment_event_id'],
    ['event_note','previous_note_event_id'],
    ['event_staff_assignment','related_assignment_event_id'],
    ['event_insurance','related_start_event_id'],
    ['event_pregnancy_check','insemination_event_id'],
    ['event_pregnancy_loss','pregnancy_check_event_id'],
    ['event_dry_off','pregnancy_check_event_id'],
    ['event_diagnosis_resolution','diagnosis_event_id'],
    ['event_withdrawal_end','withdrawal_start_event_id'],
    ['event_protocol_step','assignment_event_id'],
    ['event_protocol_completion','assignment_event_id'],
    ['event_protocol_cancellation','assignment_event_id']
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_linked_tenant BEFORE INSERT OR UPDATE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION validate_linked_event_tenant(%L)',
      item[1], item[1], item[2]
    );
  END LOOP;
END;
$$;

CREATE FUNCTION validate_active_identifier() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.action = 'ASSIGNED' AND EXISTS (
    SELECT 1
    FROM event_identifier_change assigned
    JOIN animal_event assigned_event
      ON (assigned_event.id,assigned_event.farm_id)=(assigned.event_id,assigned.farm_id)
    WHERE assigned.farm_id=NEW.farm_id
      AND assigned.identifier_type=NEW.identifier_type
      AND assigned.identifier_value=NEW.identifier_value
      AND assigned.action='ASSIGNED'
      AND assigned_event.animal_id <> (
        SELECT animal_id FROM animal_event WHERE id=NEW.event_id AND farm_id=NEW.farm_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM event_identifier_change removed
        WHERE removed.related_assignment_event_id=assigned.event_id AND removed.action='REMOVED'
      )
  ) THEN RAISE EXCEPTION 'identifier is active on another animal'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER active_identifier_validate
BEFORE INSERT OR UPDATE ON event_identifier_change
FOR EACH ROW EXECUTE FUNCTION validate_active_identifier();
