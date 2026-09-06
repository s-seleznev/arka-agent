CREATE FUNCTION effective_animal_events(
  p_as_of timestamptz,
  p_knowledge timestamptz
) RETURNS TABLE (
  id uuid,
  farm_id uuid,
  animal_id uuid,
  event_type_id uuid,
  event_code text,
  occurred_at timestamptz,
  recorded_at timestamptz,
  related_event_id uuid,
  supersedes_event_id uuid
)
LANGUAGE sql STABLE AS $$
  SELECT ae.id, ae.farm_id, ae.animal_id, ae.event_type_id, et.code,
         ae.occurred_at, ae.recorded_at, ae.related_event_id, ae.supersedes_event_id
  FROM animal_event ae
  JOIN event_type et ON et.id = ae.event_type_id
  WHERE ae.occurred_at <= p_as_of
    AND ae.recorded_at <= p_knowledge
    AND (ae.voided_at IS NULL OR ae.voided_at > p_knowledge)
    AND NOT EXISTS (
      SELECT 1
      FROM animal_event correction
      WHERE correction.supersedes_event_id = ae.id
        AND correction.recorded_at <= p_knowledge
        AND (correction.voided_at IS NULL OR correction.voided_at > p_knowledge)
    );
$$;

CREATE FUNCTION animal_state_at(
  p_as_of timestamptz,
  p_knowledge timestamptz DEFAULT clock_timestamp()
) RETURNS TABLE (
  farm_id uuid,
  animal_id uuid,
  primary_identifier text,
  name text,
  sex text,
  birth_date date,
  age_days integer,
  group_id uuid,
  group_code text,
  status_code text,
  lactation_number integer,
  days_in_milk integer,
  last_calving_at timestamptz,
  last_insemination_at timestamptz,
  pregnancy_check_at timestamptz,
  is_pregnant boolean,
  pregnancy_days integer,
  expected_calving_date date,
  expected_dry_off_date date,
  last_milk_kg numeric,
  last_weight_kg numeric,
  active_diagnosis_count integer,
  active_protocol_count integer,
  active_withdrawal_count integer,
  assigned_staff_ids text[],
  active_insurance_policy text,
  latest_note text,
  is_archived boolean,
  is_exited boolean
)
LANGUAGE sql STABLE AS $$
  WITH effective AS NOT MATERIALIZED (
    SELECT * FROM effective_animal_events(p_as_of, p_knowledge)
  )
  SELECT
    a.farm_id,
    a.id,
    identifier.identifier_value,
    a.name,
    a.sex,
    a.birth_date,
    (p_as_of::date - a.birth_date)::integer,
    group_state.new_group_id,
    fg.code,
    status_state.status_code,
    COALESCE(calving.lactation_number, 0)::integer,
    CASE WHEN calving.last_calving_at IS NULL THEN NULL
         ELSE (p_as_of::date - calving.last_calving_at::date)::integer END,
    calving.last_calving_at,
    insemination.last_insemination_at,
    pregnancy.pregnancy_check_at,
    COALESCE(pregnancy.is_pregnant, false),
    CASE WHEN pregnancy.is_pregnant
         THEN (p_as_of::date - insemination.last_insemination_at::date)::integer END,
    CASE WHEN pregnancy.is_pregnant
         THEN insemination.last_insemination_at::date + COALESCE(gestation.days, 280)::integer END,
    CASE WHEN pregnancy.is_pregnant
         THEN insemination.last_insemination_at::date
              + COALESCE(gestation.days, 280)::integer
              - COALESCE(dry_period.days, 60)::integer END,
    milk.milk_kg,
    weight.weight_kg,
    COALESCE(diagnoses.active_count, 0)::integer,
    COALESCE(protocols.active_count, 0)::integer,
    COALESCE(withdrawals.active_count, 0)::integer,
    COALESCE(staff.subject_ids, ARRAY[]::text[]),
    insurance.policy_number,
    note.note_text,
    COALESCE(archive_state.is_archived, false),
    (exit_state.event_id IS NOT NULL)
  FROM animal a
  LEFT JOIN LATERAL (
    SELECT eic.identifier_value
    FROM effective e
    JOIN event_identifier_change eic ON (eic.event_id, eic.farm_id) = (e.id, e.farm_id)
    WHERE e.animal_id = a.id AND e.farm_id = a.farm_id
      AND eic.action = 'ASSIGNED' AND eic.is_primary
      AND NOT EXISTS (
        SELECT 1 FROM effective removed
        JOIN event_identifier_change rem
          ON (rem.event_id, rem.farm_id) = (removed.id, removed.farm_id)
        WHERE rem.related_assignment_event_id = e.id AND rem.action = 'REMOVED'
      )
    ORDER BY e.occurred_at DESC, e.recorded_at DESC LIMIT 1
  ) identifier ON true
  LEFT JOIN LATERAL (
    SELECT egc.new_group_id
    FROM effective e
    JOIN event_group_change egc ON (egc.event_id, egc.farm_id) = (e.id, e.farm_id)
    WHERE e.animal_id = a.id AND e.farm_id = a.farm_id
    ORDER BY e.occurred_at DESC, e.recorded_at DESC LIMIT 1
  ) group_state ON true
  LEFT JOIN farm_group fg ON fg.id = group_state.new_group_id
  LEFT JOIN LATERAL (
    SELECT ast.code AS status_code
    FROM effective e
    JOIN event_status_change esc ON (esc.event_id, esc.farm_id) = (e.id, e.farm_id)
    JOIN animal_status_type ast ON ast.id = esc.new_status_id
    WHERE e.animal_id = a.id AND e.farm_id = a.farm_id
    ORDER BY e.occurred_at DESC, e.recorded_at DESC LIMIT 1
  ) status_state ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS lactation_number, max(e.occurred_at) AS last_calving_at
    FROM effective e
    WHERE e.animal_id = a.id AND e.farm_id = a.farm_id AND e.event_code = 'CALVED'
  ) calving ON true
  LEFT JOIN LATERAL (
    SELECT max(e.occurred_at) AS last_insemination_at
    FROM effective e
    WHERE e.animal_id = a.id AND e.farm_id = a.farm_id AND e.event_code = 'INSEMINATED'
  ) insemination ON true
  LEFT JOIN LATERAL (
    SELECT e.occurred_at AS pregnancy_check_at,
           epc.result = 'PREGNANT'
             AND NOT EXISTS (
               SELECT 1 FROM effective later
               WHERE later.animal_id = a.id AND later.farm_id = a.farm_id
                 AND later.occurred_at > e.occurred_at
                 AND later.event_code IN ('PREGNANCY_LOST', 'CALVED')
             ) AS is_pregnant
    FROM effective e
    JOIN event_pregnancy_check epc ON (epc.event_id, epc.farm_id) = (e.id, e.farm_id)
    WHERE e.animal_id = a.id AND e.farm_id = a.farm_id
    ORDER BY e.occurred_at DESC, e.recorded_at DESC LIMIT 1
  ) pregnancy ON true
  LEFT JOIN LATERAL (
    SELECT fr.value_numeric::integer AS days
    FROM farm_rule fr WHERE fr.farm_id = a.farm_id AND fr.code = 'GESTATION_DAYS'
      AND fr.valid_from <= p_as_of AND (fr.valid_to IS NULL OR fr.valid_to > p_as_of)
    ORDER BY fr.valid_from DESC LIMIT 1
  ) gestation ON true
  LEFT JOIN LATERAL (
    SELECT fr.value_numeric::integer AS days
    FROM farm_rule fr WHERE fr.farm_id = a.farm_id AND fr.code = 'DRY_PERIOD_DAYS'
      AND fr.valid_from <= p_as_of AND (fr.valid_to IS NULL OR fr.valid_to > p_as_of)
    ORDER BY fr.valid_from DESC LIMIT 1
  ) dry_period ON true
  LEFT JOIN LATERAL (
    SELECT edm.milk_kg
    FROM effective e JOIN event_daily_milk edm
      ON (edm.event_id, edm.farm_id) = (e.id, e.farm_id)
    WHERE e.animal_id = a.id AND e.farm_id = a.farm_id
    ORDER BY e.occurred_at DESC, e.recorded_at DESC LIMIT 1
  ) milk ON true
  LEFT JOIN LATERAL (
    SELECT em.value_numeric AS weight_kg
    FROM effective e JOIN event_measurement em
      ON (em.event_id, em.farm_id) = (e.id, e.farm_id)
    WHERE e.animal_id = a.id AND e.farm_id = a.farm_id
      AND em.measurement_code = 'WEIGHT' AND em.unit_code = 'KG'
    ORDER BY e.occurred_at DESC, e.recorded_at DESC LIMIT 1
  ) weight ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS active_count
    FROM effective diagnosis_event
    JOIN event_diagnosis ed
      ON (ed.event_id, ed.farm_id) = (diagnosis_event.id, diagnosis_event.farm_id)
    WHERE diagnosis_event.animal_id = a.id AND diagnosis_event.farm_id = a.farm_id
      AND NOT EXISTS (
        SELECT 1 FROM effective resolution_event
        JOIN event_diagnosis_resolution edr
          ON (edr.event_id, edr.farm_id) = (resolution_event.id, resolution_event.farm_id)
        WHERE edr.diagnosis_event_id = diagnosis_event.id
      )
  ) diagnoses ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS active_count
    FROM effective assignment_event
    JOIN event_protocol_assignment epa
      ON (epa.event_id, epa.farm_id) = (assignment_event.id, assignment_event.farm_id)
    WHERE assignment_event.animal_id = a.id AND assignment_event.farm_id = a.farm_id
      AND NOT EXISTS (
        SELECT 1 FROM effective closing_event
        LEFT JOIN event_protocol_completion epc
          ON (epc.event_id, epc.farm_id) = (closing_event.id, closing_event.farm_id)
        LEFT JOIN event_protocol_cancellation epcan
          ON (epcan.event_id, epcan.farm_id) = (closing_event.id, closing_event.farm_id)
        WHERE epc.assignment_event_id = assignment_event.id
           OR epcan.assignment_event_id = assignment_event.id
      )
  ) protocols ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS active_count
    FROM effective start_event
    JOIN event_withdrawal_start ews
      ON (ews.event_id,ews.farm_id)=(start_event.id,start_event.farm_id)
    WHERE start_event.animal_id=a.id AND start_event.farm_id=a.farm_id
      AND NOT EXISTS (
        SELECT 1 FROM effective end_event
        JOIN event_withdrawal_end ewe
          ON (ewe.event_id,ewe.farm_id)=(end_event.id,end_event.farm_id)
        WHERE ewe.withdrawal_start_event_id=start_event.id
      )
  ) withdrawals ON true
  LEFT JOIN LATERAL (
    SELECT array_agg(esa.subject_id ORDER BY esa.subject_id) AS subject_ids
    FROM effective assignment_event
    JOIN event_staff_assignment esa
      ON (esa.event_id,esa.farm_id)=(assignment_event.id,assignment_event.farm_id)
    WHERE assignment_event.animal_id=a.id AND assignment_event.farm_id=a.farm_id
      AND esa.action='ASSIGNED' AND NOT EXISTS (
        SELECT 1 FROM effective unassignment_event
        JOIN event_staff_assignment unassigned
          ON (unassigned.event_id,unassigned.farm_id)=(unassignment_event.id,unassignment_event.farm_id)
        WHERE unassigned.action='UNASSIGNED'
          AND unassigned.related_assignment_event_id=assignment_event.id
      )
  ) staff ON true
  LEFT JOIN LATERAL (
    SELECT ei.policy_number
    FROM effective e JOIN event_insurance ei ON (ei.event_id,ei.farm_id)=(e.id,e.farm_id)
    WHERE e.animal_id=a.id AND e.farm_id=a.farm_id
    ORDER BY e.occurred_at DESC,e.recorded_at DESC LIMIT 1
  ) insurance ON insurance.policy_number IS NOT NULL AND EXISTS (
    SELECT 1 FROM effective ie JOIN event_insurance current_insurance
      ON (current_insurance.event_id,current_insurance.farm_id)=(ie.id,ie.farm_id)
    WHERE ie.animal_id=a.id AND ie.farm_id=a.farm_id
      AND current_insurance.action='STARTED'
      AND current_insurance.policy_number=insurance.policy_number
      AND NOT EXISTS (
        SELECT 1 FROM effective ended JOIN event_insurance ending
          ON (ending.event_id,ending.farm_id)=(ended.id,ended.farm_id)
        WHERE ending.related_start_event_id=ie.id AND ending.action='ENDED'
      )
  )
  LEFT JOIN LATERAL (
    SELECT en.note_text
    FROM effective e JOIN event_note en ON (en.event_id,en.farm_id)=(e.id,e.farm_id)
    WHERE e.animal_id=a.id AND e.farm_id=a.farm_id AND en.action <> 'REMOVED'
    ORDER BY e.occurred_at DESC,e.recorded_at DESC LIMIT 1
  ) note ON true
  LEFT JOIN LATERAL (
    SELECT ea.action = 'ARCHIVED' AS is_archived
    FROM effective e JOIN event_archive ea ON (ea.event_id, ea.farm_id) = (e.id, e.farm_id)
    WHERE e.animal_id = a.id AND e.farm_id = a.farm_id
    ORDER BY e.occurred_at DESC, e.recorded_at DESC LIMIT 1
  ) archive_state ON true
  LEFT JOIN LATERAL (
    SELECT e.id AS event_id
    FROM effective e JOIN event_exit ee ON (ee.event_id, ee.farm_id) = (e.id, e.farm_id)
    WHERE e.animal_id = a.id AND e.farm_id = a.farm_id
    ORDER BY e.occurred_at DESC LIMIT 1
  ) exit_state ON true;
$$;

CREATE VIEW animal_state_current AS
SELECT * FROM animal_state_at(clock_timestamp(), clock_timestamp());

CREATE VIEW animal_identifier_current AS
SELECT e.farm_id, e.animal_id, d.identifier_type, d.identifier_value,
       e.id AS assignment_event_id, d.is_primary
FROM effective_animal_events(clock_timestamp(), clock_timestamp()) e
JOIN event_identifier_change d ON (d.event_id,d.farm_id)=(e.id,e.farm_id)
WHERE d.action='ASSIGNED' AND NOT EXISTS (
  SELECT 1
  FROM effective_animal_events(clock_timestamp(), clock_timestamp()) removed_event
  JOIN event_identifier_change removed
    ON (removed.event_id,removed.farm_id)=(removed_event.id,removed_event.farm_id)
  WHERE removed.action='REMOVED' AND removed.related_assignment_event_id=e.id
);

CREATE FUNCTION field_value_at(
  p_animal_id uuid,
  p_field_code text,
  p_as_of timestamptz,
  p_knowledge timestamptz DEFAULT clock_timestamp()
) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE
  state_row record;
  result jsonb;
BEGIN
  SELECT * INTO state_row
  FROM animal_state_at(p_as_of, p_knowledge) s WHERE s.animal_id = p_animal_id;

  result := CASE p_field_code
    WHEN 'AGE_DAYS' THEN to_jsonb(state_row.age_days)
    WHEN 'LACTATION_NUMBER' THEN to_jsonb(state_row.lactation_number)
    WHEN 'DAYS_IN_MILK' THEN to_jsonb(state_row.days_in_milk)
    WHEN 'DAYS_SINCE_INSEMINATION' THEN to_jsonb((p_as_of::date - state_row.last_insemination_at::date)::integer)
    WHEN 'EXPECTED_CALVING_DATE' THEN to_jsonb(state_row.expected_calving_date)
    WHEN 'EXPECTED_DRY_OFF_DATE' THEN to_jsonb(state_row.expected_dry_off_date)
    WHEN 'LAST_MILK_KG' THEN to_jsonb(state_row.last_milk_kg)
    WHEN 'LAST_WEIGHT_KG' THEN to_jsonb(state_row.last_weight_kg)
    ELSE NULL
  END;

  IF result IS NOT NULL THEN RETURN result; END IF;

  SELECT CASE fd.value_type
    WHEN 'TEXT' THEN to_jsonb(cev.value_text)
    WHEN 'INTEGER' THEN to_jsonb(cev.value_numeric::bigint)
    WHEN 'NUMERIC' THEN to_jsonb(cev.value_numeric)
    WHEN 'ENUM' THEN to_jsonb(cev.value_text)
    WHEN 'BOOLEAN' THEN to_jsonb(cev.value_boolean)
    WHEN 'DATE' THEN to_jsonb(cev.value_date)
    WHEN 'TIMESTAMP' THEN to_jsonb(cev.value_timestamp)
    WHEN 'REFERENCE' THEN to_jsonb(cev.value_reference) END
  INTO result
  FROM effective_animal_events(p_as_of, p_knowledge) e
  JOIN custom_event_value cev ON (cev.event_id, cev.farm_id) = (e.id, e.farm_id)
  JOIN field_definition fd ON fd.id = cev.field_definition_id
  WHERE e.animal_id = p_animal_id AND fd.code = p_field_code
  ORDER BY e.occurred_at DESC, e.recorded_at DESC LIMIT 1;

  RETURN result;
END;
$$;
