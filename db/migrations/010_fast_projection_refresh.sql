CREATE OR REPLACE FUNCTION refresh_animal_state_query() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  inserted_rows bigint;
  snapshot_at timestamptz := clock_timestamp();
BEGIN
  TRUNCATE animal_state_query;

  WITH effective AS MATERIALIZED (
    SELECT * FROM effective_animal_events(snapshot_at, snapshot_at)
  ),
  removed_identifiers AS (
    SELECT detail.related_assignment_event_id AS event_id
    FROM effective event
    JOIN event_identifier_change detail
      ON (detail.event_id, detail.farm_id) = (event.id, event.farm_id)
    WHERE detail.action = 'REMOVED'
  ),
  identifiers AS (
    SELECT DISTINCT ON (event.farm_id, event.animal_id)
      event.farm_id, event.animal_id, detail.identifier_value
    FROM effective event
    JOIN event_identifier_change detail
      ON (detail.event_id, detail.farm_id) = (event.id, event.farm_id)
    LEFT JOIN removed_identifiers removed ON removed.event_id = event.id
    WHERE detail.action = 'ASSIGNED' AND detail.is_primary AND removed.event_id IS NULL
    ORDER BY event.farm_id, event.animal_id, event.occurred_at DESC, event.recorded_at DESC
  ),
  groups AS (
    SELECT DISTINCT ON (event.farm_id, event.animal_id)
      event.farm_id, event.animal_id, detail.new_group_id
    FROM effective event
    JOIN event_group_change detail
      ON (detail.event_id, detail.farm_id) = (event.id, event.farm_id)
    ORDER BY event.farm_id, event.animal_id, event.occurred_at DESC, event.recorded_at DESC
  ),
  statuses AS (
    SELECT DISTINCT ON (event.farm_id, event.animal_id)
      event.farm_id, event.animal_id, status.code
    FROM effective event
    JOIN event_status_change detail
      ON (detail.event_id, detail.farm_id) = (event.id, event.farm_id)
    JOIN animal_status_type status ON status.id = detail.new_status_id
    ORDER BY event.farm_id, event.animal_id, event.occurred_at DESC, event.recorded_at DESC
  ),
  calvings AS (
    SELECT farm_id, animal_id, count(*)::integer AS lactation_number,
           max(occurred_at) AS last_calving_at
    FROM effective WHERE event_code = 'CALVED' GROUP BY farm_id, animal_id
  ),
  inseminations AS (
    SELECT farm_id, animal_id, max(occurred_at) AS last_insemination_at
    FROM effective WHERE event_code = 'INSEMINATED' GROUP BY farm_id, animal_id
  ),
  pregnancy_checks AS (
    SELECT DISTINCT ON (event.farm_id, event.animal_id)
      event.farm_id, event.animal_id, event.occurred_at AS pregnancy_check_at,
      detail.result
    FROM effective event
    JOIN event_pregnancy_check detail
      ON (detail.event_id, detail.farm_id) = (event.id, event.farm_id)
    ORDER BY event.farm_id, event.animal_id, event.occurred_at DESC, event.recorded_at DESC
  ),
  pregnancy_ends AS (
    SELECT farm_id, animal_id, max(occurred_at) AS ended_at
    FROM effective WHERE event_code IN ('PREGNANCY_LOST', 'CALVED')
    GROUP BY farm_id, animal_id
  ),
  pregnancies AS (
    SELECT check_state.farm_id, check_state.animal_id,
           check_state.pregnancy_check_at,
           check_state.result = 'PREGNANT'
             AND (ending.ended_at IS NULL OR ending.ended_at <= check_state.pregnancy_check_at)
             AS is_pregnant
    FROM pregnancy_checks check_state
    LEFT JOIN pregnancy_ends ending USING (farm_id, animal_id)
  ),
  active_rules AS (
    SELECT DISTINCT ON (farm_id, code) farm_id, code, value_numeric::integer AS days
    FROM farm_rule
    WHERE valid_from <= snapshot_at AND (valid_to IS NULL OR valid_to > snapshot_at)
    ORDER BY farm_id, code, valid_from DESC
  ),
  rules AS (
    SELECT farm_id,
      max(days) FILTER (WHERE code = 'GESTATION_DAYS') AS gestation_days,
      max(days) FILTER (WHERE code = 'DRY_PERIOD_DAYS') AS dry_period_days
    FROM active_rules GROUP BY farm_id
  ),
  milk AS (
    SELECT DISTINCT ON (event.farm_id, event.animal_id)
      event.farm_id, event.animal_id, detail.milk_kg
    FROM effective event
    JOIN event_daily_milk detail
      ON (detail.event_id, detail.farm_id) = (event.id, event.farm_id)
    ORDER BY event.farm_id, event.animal_id, event.occurred_at DESC, event.recorded_at DESC
  ),
  weights AS (
    SELECT DISTINCT ON (event.farm_id, event.animal_id)
      event.farm_id, event.animal_id, detail.value_numeric AS weight_kg
    FROM effective event
    JOIN event_measurement detail
      ON (detail.event_id, detail.farm_id) = (event.id, event.farm_id)
    WHERE detail.measurement_code = 'WEIGHT' AND detail.unit_code = 'KG'
    ORDER BY event.farm_id, event.animal_id, event.occurred_at DESC, event.recorded_at DESC
  ),
  resolved_diagnoses AS (
    SELECT detail.diagnosis_event_id AS event_id
    FROM effective event
    JOIN event_diagnosis_resolution detail
      ON (detail.event_id, detail.farm_id) = (event.id, event.farm_id)
  ),
  diagnoses AS (
    SELECT event.farm_id, event.animal_id, count(*)::integer AS active_count
    FROM effective event
    JOIN event_diagnosis detail
      ON (detail.event_id, detail.farm_id) = (event.id, event.farm_id)
    LEFT JOIN resolved_diagnoses resolved ON resolved.event_id = event.id
    WHERE resolved.event_id IS NULL GROUP BY event.farm_id, event.animal_id
  ),
  closed_protocols AS (
    SELECT completion.assignment_event_id AS event_id
    FROM effective event JOIN event_protocol_completion completion
      ON (completion.event_id, completion.farm_id) = (event.id, event.farm_id)
    UNION
    SELECT cancellation.assignment_event_id
    FROM effective event JOIN event_protocol_cancellation cancellation
      ON (cancellation.event_id, cancellation.farm_id) = (event.id, event.farm_id)
  ),
  protocols AS (
    SELECT event.farm_id, event.animal_id, count(*)::integer AS active_count
    FROM effective event
    JOIN event_protocol_assignment detail
      ON (detail.event_id, detail.farm_id) = (event.id, event.farm_id)
    LEFT JOIN closed_protocols closed ON closed.event_id = event.id
    WHERE closed.event_id IS NULL GROUP BY event.farm_id, event.animal_id
  ),
  ended_withdrawals AS (
    SELECT detail.withdrawal_start_event_id AS event_id
    FROM effective event JOIN event_withdrawal_end detail
      ON (detail.event_id, detail.farm_id) = (event.id, event.farm_id)
  ),
  withdrawals AS (
    SELECT event.farm_id, event.animal_id, count(*)::integer AS active_count
    FROM effective event JOIN event_withdrawal_start detail
      ON (detail.event_id, detail.farm_id) = (event.id, event.farm_id)
    LEFT JOIN ended_withdrawals ended ON ended.event_id = event.id
    WHERE ended.event_id IS NULL GROUP BY event.farm_id, event.animal_id
  ),
  unassigned_staff AS (
    SELECT detail.related_assignment_event_id AS event_id
    FROM effective event JOIN event_staff_assignment detail
      ON (detail.event_id, detail.farm_id) = (event.id, event.farm_id)
    WHERE detail.action = 'UNASSIGNED'
  ),
  staff AS (
    SELECT event.farm_id, event.animal_id,
           array_agg(detail.subject_id ORDER BY detail.subject_id) AS subject_ids
    FROM effective event JOIN event_staff_assignment detail
      ON (detail.event_id, detail.farm_id) = (event.id, event.farm_id)
    LEFT JOIN unassigned_staff removed ON removed.event_id = event.id
    WHERE detail.action = 'ASSIGNED' AND removed.event_id IS NULL
    GROUP BY event.farm_id, event.animal_id
  ),
  ended_insurance AS (
    SELECT detail.related_start_event_id AS event_id
    FROM effective event JOIN event_insurance detail
      ON (detail.event_id, detail.farm_id) = (event.id, event.farm_id)
    WHERE detail.action = 'ENDED'
  ),
  insurance AS (
    SELECT DISTINCT ON (event.farm_id, event.animal_id)
      event.farm_id, event.animal_id, detail.policy_number
    FROM effective event JOIN event_insurance detail
      ON (detail.event_id, detail.farm_id) = (event.id, event.farm_id)
    LEFT JOIN ended_insurance ended ON ended.event_id = event.id
    WHERE detail.action = 'STARTED' AND ended.event_id IS NULL
    ORDER BY event.farm_id, event.animal_id, event.occurred_at DESC, event.recorded_at DESC
  ),
  notes AS (
    SELECT DISTINCT ON (event.farm_id, event.animal_id)
      event.farm_id, event.animal_id, detail.note_text
    FROM effective event JOIN event_note detail
      ON (detail.event_id, detail.farm_id) = (event.id, event.farm_id)
    WHERE detail.action <> 'REMOVED'
    ORDER BY event.farm_id, event.animal_id, event.occurred_at DESC, event.recorded_at DESC
  ),
  archives AS (
    SELECT DISTINCT ON (event.farm_id, event.animal_id)
      event.farm_id, event.animal_id, detail.action = 'ARCHIVED' AS is_archived
    FROM effective event JOIN event_archive detail
      ON (detail.event_id, detail.farm_id) = (event.id, event.farm_id)
    ORDER BY event.farm_id, event.animal_id, event.occurred_at DESC, event.recorded_at DESC
  ),
  exits AS (
    SELECT DISTINCT event.farm_id, event.animal_id
    FROM effective event JOIN event_exit detail
      ON (detail.event_id, detail.farm_id) = (event.id, event.farm_id)
  )
  INSERT INTO animal_state_query
  SELECT animal.farm_id, animal.id, identifier.identifier_value, animal.name,
    animal.sex, animal.birth_date, (snapshot_at::date - animal.birth_date)::integer,
    group_state.new_group_id, farm_group.code, status_state.code,
    COALESCE(calving.lactation_number, 0)::integer,
    CASE WHEN calving.last_calving_at IS NULL THEN NULL
      ELSE (snapshot_at::date - calving.last_calving_at::date)::integer END,
    calving.last_calving_at, insemination.last_insemination_at,
    pregnancy.pregnancy_check_at, COALESCE(pregnancy.is_pregnant, false),
    CASE WHEN pregnancy.is_pregnant
      THEN (snapshot_at::date - insemination.last_insemination_at::date)::integer END,
    CASE WHEN pregnancy.is_pregnant
      THEN insemination.last_insemination_at::date + COALESCE(rule.gestation_days, 280) END,
    CASE WHEN pregnancy.is_pregnant THEN insemination.last_insemination_at::date
      + COALESCE(rule.gestation_days, 280) - COALESCE(rule.dry_period_days, 60) END,
    latest_milk.milk_kg, weight.weight_kg,
    COALESCE(diagnosis.active_count, 0)::integer,
    COALESCE(protocol.active_count, 0)::integer,
    COALESCE(withdrawal.active_count, 0)::integer,
    COALESCE(assigned_staff.subject_ids, ARRAY[]::text[]),
    active_insurance.policy_number, note.note_text,
    COALESCE(archive_state.is_archived, false), exit_state.animal_id IS NOT NULL
  FROM animal
  LEFT JOIN identifiers identifier
    ON identifier.farm_id = animal.farm_id AND identifier.animal_id = animal.id
  LEFT JOIN groups group_state
    ON group_state.farm_id = animal.farm_id AND group_state.animal_id = animal.id
  LEFT JOIN farm_group ON farm_group.id = group_state.new_group_id
  LEFT JOIN statuses status_state
    ON status_state.farm_id = animal.farm_id AND status_state.animal_id = animal.id
  LEFT JOIN calvings calving
    ON calving.farm_id = animal.farm_id AND calving.animal_id = animal.id
  LEFT JOIN inseminations insemination
    ON insemination.farm_id = animal.farm_id AND insemination.animal_id = animal.id
  LEFT JOIN pregnancies pregnancy
    ON pregnancy.farm_id = animal.farm_id AND pregnancy.animal_id = animal.id
  LEFT JOIN rules rule ON rule.farm_id = animal.farm_id
  LEFT JOIN milk latest_milk
    ON latest_milk.farm_id = animal.farm_id AND latest_milk.animal_id = animal.id
  LEFT JOIN weights weight
    ON weight.farm_id = animal.farm_id AND weight.animal_id = animal.id
  LEFT JOIN diagnoses diagnosis
    ON diagnosis.farm_id = animal.farm_id AND diagnosis.animal_id = animal.id
  LEFT JOIN protocols protocol
    ON protocol.farm_id = animal.farm_id AND protocol.animal_id = animal.id
  LEFT JOIN withdrawals withdrawal
    ON withdrawal.farm_id = animal.farm_id AND withdrawal.animal_id = animal.id
  LEFT JOIN staff assigned_staff
    ON assigned_staff.farm_id = animal.farm_id AND assigned_staff.animal_id = animal.id
  LEFT JOIN insurance active_insurance
    ON active_insurance.farm_id = animal.farm_id AND active_insurance.animal_id = animal.id
  LEFT JOIN notes note
    ON note.farm_id = animal.farm_id AND note.animal_id = animal.id
  LEFT JOIN archives archive_state
    ON archive_state.farm_id = animal.farm_id AND archive_state.animal_id = animal.id
  LEFT JOIN exits exit_state
    ON exit_state.farm_id = animal.farm_id AND exit_state.animal_id = animal.id;

  GET DIAGNOSTICS inserted_rows = ROW_COUNT;
  RETURN inserted_rows;
END;
$$;
