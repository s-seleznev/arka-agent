CREATE TABLE IF NOT EXISTS farm_reference_label (
 farm_id uuid NOT NULL REFERENCES farm(id),kind text NOT NULL,reference text NOT NULL,label text NOT NULL,
 PRIMARY KEY(farm_id,kind,reference)
);
ALTER TABLE farm_reference_label ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename='farm_reference_label' AND policyname='reference_label_isolation') THEN
 CREATE POLICY reference_label_isolation ON farm_reference_label FOR SELECT TO arka_reader USING(farm_id=nullif(current_setting('arka.farm_id',true),'')::uuid);
END IF; END $$;
GRANT SELECT ON farm_reference_label TO arka_reader;
-- Read-only event facts for operational reports. Invoker permissions and tenant predicates remain active.
CREATE OR REPLACE FUNCTION farm_report_facts(p_animal uuid,p_farm uuid) RETURNS jsonb
LANGUAGE sql STABLE AS $$
WITH e AS MATERIALIZED (
 SELECT a.*,t.code,CASE t.code WHEN 'CALVED' THEN 'Отёл' WHEN 'HEALTH_OBSERVED' THEN 'Осмотр' ELSE t.code END event_name FROM animal_event a JOIN event_type t ON t.id=a.event_type_id
 WHERE a.animal_id=p_animal AND a.farm_id=p_farm AND a.occurred_at<=now() AND a.recorded_at<=now() AND a.voided_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM animal_event c WHERE c.supersedes_event_id=a.id AND c.farm_id=p_farm AND c.occurred_at<=now() AND c.recorded_at<=now() AND c.voided_at IS NULL)
), ai AS (SELECT e.occurred_at,d.* FROM e JOIN event_insemination d ON d.event_id=e.id AND d.farm_id=p_farm ORDER BY e.occurred_at DESC,e.recorded_at DESC,e.id DESC LIMIT 1),
 ex AS (SELECT e.occurred_at,e.comment,d.reason FROM e JOIN event_exit d ON d.event_id=e.id AND d.farm_id=p_farm ORDER BY e.occurred_at DESC LIMIT 1),
 active AS (
 SELECT e.id,coalesce(d.planned_start_at,e.occurred_at) start_at,p.id protocol_id,p.name,p.category,
 (SELECT max(offset_hours)/24+1 FROM protocol_step_definition WHERE protocol_id=p.id) duration
 FROM e JOIN event_protocol_assignment d ON d.event_id=e.id AND d.farm_id=p_farm JOIN protocol_definition p ON p.id=d.protocol_id
 WHERE NOT EXISTS(SELECT 1 FROM e x JOIN event_protocol_completion c ON c.event_id=x.id WHERE c.assignment_event_id=e.id)
 AND NOT EXISTS(SELECT 1 FROM e x JOIN event_protocol_cancellation c ON c.event_id=x.id WHERE c.assignment_event_id=e.id)
), next_steps AS (
 SELECT a.id,min(a.start_at+make_interval(hours=>s.offset_hours)) next_at FROM active a JOIN protocol_step_definition s ON s.protocol_id=a.protocol_id
 WHERE NOT EXISTS(SELECT 1 FROM e x JOIN event_protocol_step c ON c.event_id=x.id WHERE c.assignment_event_id=a.id AND c.step_definition_id=s.id) GROUP BY a.id
), weights AS (SELECT e.occurred_at,d.value_numeric weight_kg,row_number() OVER(ORDER BY e.occurred_at DESC,e.recorded_at DESC,e.id DESC) n FROM e JOIN event_measurement d ON d.event_id=e.id AND d.farm_id=p_farm WHERE d.measurement_code='WEIGHT' AND d.unit_code='KG')
SELECT jsonb_build_object(
 'lastDryOffDate',(SELECT max(occurred_at)::date FROM e WHERE code='DRIED_OFF' AND occurred_at>=coalesce((SELECT max(occurred_at) FROM e WHERE code='CALVED'),'-infinity')),
 'bull',(SELECT coalesce((SELECT label FROM farm_reference_label WHERE farm_id=p_farm AND kind='bull' AND reference=ai.bull_ref),bull_ref) FROM ai),'technician',(SELECT coalesce((SELECT label FROM farm_reference_label WHERE farm_id=p_farm AND kind='technician' AND reference=ai.technician_ref),technician_ref) FROM ai),
 'inseminationNumber',(SELECT count(*) FROM e WHERE code='INSEMINATED' AND occurred_at>=coalesce((SELECT max(occurred_at) FROM e WHERE code='CALVED'),'-infinity')),
 'exitDate',(SELECT occurred_at::date FROM ex),'exitReason',(SELECT reason FROM ex),
 'exitDIM',(SELECT ex.occurred_at::date-(SELECT max(occurred_at)::date FROM e WHERE code='CALVED' AND occurred_at<=ex.occurred_at) FROM ex),
 'yesterdayMilk',(SELECT d.milk_kg FROM e JOIN event_daily_milk d ON d.event_id=e.id JOIN farm f ON f.id=p_farm WHERE d.farm_id=p_farm AND d.farm_date=(now() AT TIME ZONE f.timezone)::date-1 ORDER BY e.occurred_at DESC LIMIT 1),
 'lastClinicalEvent',(SELECT coalesce(dd.name,e.event_name)||' '||to_char(e.occurred_at,'DD.MM.YYYY') FROM e LEFT JOIN event_diagnosis d ON d.event_id=e.id LEFT JOIN disease_definition dd ON dd.id=d.disease_id WHERE e.code IN('CALVED','DIAGNOSED','HEALTH_OBSERVED') ORDER BY e.occurred_at DESC LIMIT 1),
 'note',(SELECT CASE WHEN d.action='REMOVED' THEN NULL ELSE d.note_text END FROM e JOIN event_note d ON d.event_id=e.id AND d.farm_id=p_farm ORDER BY e.occurred_at DESC,e.recorded_at DESC,e.id DESC LIMIT 1),
 'gain',(SELECT round((w1.weight_kg-w2.weight_kg)*1000/nullif(extract(epoch FROM w1.occurred_at-w2.occurred_at)/86400,0)) FROM weights w1 CROSS JOIN weights w2 WHERE w1.n=1 AND w2.n=2),
 'protocols',(SELECT string_agg(name,'; ' ORDER BY id) FROM active),
 'protocolDay',(SELECT string_agg(name||': '||(((now() AT TIME ZONE (SELECT timezone FROM farm WHERE id=p_farm))::date-(start_at AT TIME ZONE (SELECT timezone FROM farm WHERE id=p_farm))::date)+1)||' из '||duration,'; ' ORDER BY id) FROM active),
 'nextProtocolDate',(SELECT min(next_at)::date FROM next_steps),
 'responsible',(SELECT string_agg(DISTINCT d.subject_id,', ') FROM e JOIN event_staff_assignment d ON d.event_id=e.id AND d.farm_id=p_farm WHERE d.action='ASSIGNED' AND NOT EXISTS(SELECT 1 FROM e x JOIN event_staff_assignment z ON z.event_id=x.id WHERE z.related_assignment_event_id=e.id AND z.action='UNASSIGNED'))
);
$$;
