INSERT INTO unit_definition(code, dimension, name, factor_to_base) VALUES
  ('KG', 'MASS', 'килограмм', 1),
  ('G', 'MASS', 'грамм', 0.001),
  ('ML', 'VOLUME', 'миллилитр', 1),
  ('CELSIUS', 'TEMPERATURE', 'градус Цельсия', 1),
  ('DAY', 'TIME', 'день', 1),
  ('HOUR', 'TIME', 'час', 1.0 / 24),
  ('PERCENT', 'RATIO', 'процент', 0.01),
  ('SCORE', 'SCORE', 'балл', 1)
ON CONFLICT (code) DO NOTHING;

WITH source(code, name, category) AS (VALUES
  ('HEIFER', 'Тёлка', 'REPRODUCTION'),
  ('BULL', 'Бык', 'DEMOGRAPHY'),
  ('READY_FOR_INSEMINATION', 'Готова к осеменению', 'REPRODUCTION'),
  ('INSEMINATED', 'Осеменена', 'REPRODUCTION'),
  ('PREGNANT', 'Стельная', 'REPRODUCTION'),
  ('FRESH', 'Новотельная', 'LACTATION'),
  ('LACTATING', 'Дойная', 'LACTATION'),
  ('DRY', 'Сухостой', 'LACTATION'),
  ('LATE_DRY', 'Поздний сухостой', 'LACTATION'),
  ('DO_NOT_INSEMINATE', 'Не осеменять', 'REPRODUCTION'),
  ('CULLED', 'Выбракована', 'EXIT'),
  ('SOLD', 'Продана', 'EXIT'),
  ('DEAD', 'Пала', 'EXIT'),
  ('SELL_READY', 'Готов к продаже', 'EXIT')
)
INSERT INTO animal_status_type(id, farm_id, code, name, category)
SELECT md5('status:' || code)::uuid, NULL, code, name, category FROM source
ON CONFLICT DO NOTHING;

WITH source(code, name, category) AS (VALUES
  ('LAMENESS', 'Хромота', 'LOCOMOTION'),
  ('MASTITIS', 'Мастит', 'UDDER'),
  ('METRITIS', 'Метрит', 'REPRODUCTION'),
  ('KETOSIS', 'Кетоз', 'METABOLIC'),
  ('RESPIRATORY_DISEASE', 'Респираторное заболевание', 'RESPIRATORY')
)
INSERT INTO disease_definition(id, farm_id, code, name, category)
SELECT md5('disease:' || code)::uuid, NULL, code, name, category FROM source
ON CONFLICT DO NOTHING;

INSERT INTO product_definition(
  id, farm_id, code, name, product_type, dose_unit_code, default_withdrawal_hours
) VALUES
  (md5('product:MASTITIS_DRUG')::uuid, NULL, 'MASTITIS_DRUG', 'Средство от мастита', 'DRUG', 'ML', 72),
  (md5('product:BASE_VACCINE')::uuid, NULL, 'BASE_VACCINE', 'Базовая вакцина', 'VACCINE', 'ML', 0)
ON CONFLICT DO NOTHING;

WITH source(code, name, category) AS (VALUES
  ('HOOF_TRIM', 'Расчистка копыт', 'HOOF'),
  ('PREGNANCY_ULTRASOUND', 'УЗИ стельности', 'REPRODUCTION'),
  ('FRESH_COW_CHECK', 'Осмотр новотельной коровы', 'HEALTH')
)
INSERT INTO procedure_definition(id, farm_id, code, name, category)
SELECT md5('procedure:' || code)::uuid, NULL, code, name, category FROM source
ON CONFLICT DO NOTHING;

INSERT INTO protocol_definition(
  id, farm_id, code, name, category, version, valid_from
) VALUES
  (md5('protocol:OVSYNCH:1')::uuid, NULL, 'OVSYNCH', 'Ovsynch', 'REPRODUCTION', 1, '2020-01-01Z'),
  (md5('protocol:MASTITIS:1')::uuid, NULL, 'MASTITIS_TREATMENT', 'Лечение мастита', 'TREATMENT', 1, '2020-01-01Z'),
  (md5('protocol:FRESH:1')::uuid, NULL, 'FRESH_COW_CHECK', 'Контроль новотельных', 'PREVENTION', 1, '2020-01-01Z')
ON CONFLICT DO NOTHING;

INSERT INTO protocol_step_definition(id, protocol_id, step_code, position, offset_hours, action_code) VALUES
  (md5('step:OVSYNCH:GNRH1')::uuid, md5('protocol:OVSYNCH:1')::uuid, 'GNRH1', 1, 0, 'INJECTION'),
  (md5('step:OVSYNCH:PGF')::uuid, md5('protocol:OVSYNCH:1')::uuid, 'PGF', 2, 168, 'INJECTION'),
  (md5('step:OVSYNCH:AI')::uuid, md5('protocol:OVSYNCH:1')::uuid, 'AI', 3, 216, 'INSEMINATION'),
  (md5('step:MASTITIS:DOSE1')::uuid, md5('protocol:MASTITIS:1')::uuid, 'DOSE1', 1, 0, 'TREATMENT'),
  (md5('step:FRESH:CHECK')::uuid, md5('protocol:FRESH:1')::uuid, 'CHECK', 1, 0, 'OBSERVATION')
ON CONFLICT DO NOTHING;

WITH source(code, family, detail_table) AS (VALUES
  ('BORN', 'LIFECYCLE', 'event_birth'),
  ('ARRIVED', 'LIFECYCLE', 'event_arrival'),
  ('GROUP_CHANGED', 'STATE', 'event_group_change'),
  ('STATUS_CHANGED', 'STATE', 'event_status_change'),
  ('IDENTIFIER_CHANGED', 'STATE', 'event_identifier_change'),
  ('ARCHIVE_CHANGED', 'STATE', 'event_archive'),
  ('EXITED', 'LIFECYCLE', 'event_exit'),
  ('NOTE_CHANGED', 'ADMIN', 'event_note'),
  ('STAFF_ASSIGNMENT_CHANGED', 'ADMIN', 'event_staff_assignment'),
  ('INSURANCE_CHANGED', 'ADMIN', 'event_insurance'),
  ('HEAT_DETECTED', 'REPRODUCTION', 'event_heat'),
  ('INSEMINATED', 'REPRODUCTION', 'event_insemination'),
  ('PREGNANCY_CHECKED', 'REPRODUCTION', 'event_pregnancy_check'),
  ('PREGNANCY_LOST', 'REPRODUCTION', 'event_pregnancy_loss'),
  ('DRIED_OFF', 'REPRODUCTION', 'event_dry_off'),
  ('CALVED', 'REPRODUCTION', 'event_calving'),
  ('MILKED', 'PRODUCTION', 'event_milking'),
  ('DAILY_MILK_RECORDED', 'PRODUCTION', 'event_daily_milk'),
  ('MILK_TESTED', 'PRODUCTION', 'event_milk_test'),
  ('MEASURED', 'MEASUREMENT', 'event_measurement'),
  ('HEALTH_OBSERVED', 'HEALTH', 'event_health_observation'),
  ('DIAGNOSED', 'HEALTH', 'event_diagnosis'),
  ('DIAGNOSIS_RESOLVED', 'HEALTH', 'event_diagnosis_resolution'),
  ('TREATMENT_GIVEN', 'HEALTH', 'event_treatment'),
  ('VACCINATED', 'HEALTH', 'event_vaccination'),
  ('HOOF_PROCEDURE', 'HEALTH', 'event_hoof_procedure'),
  ('WITHDRAWAL_STARTED', 'HEALTH', 'event_withdrawal_start'),
  ('WITHDRAWAL_ENDED', 'HEALTH', 'event_withdrawal_end'),
  ('PROTOCOL_ASSIGNED', 'PROTOCOL', 'event_protocol_assignment'),
  ('PROTOCOL_STEP_COMPLETED', 'PROTOCOL', 'event_protocol_step'),
  ('PROTOCOL_COMPLETED', 'PROTOCOL', 'event_protocol_completion'),
  ('PROTOCOL_CANCELLED', 'PROTOCOL', 'event_protocol_cancellation'),
  ('CUSTOM_EVENT_RECORDED', 'CUSTOM', 'custom_event_value')
)
INSERT INTO event_type(id, farm_id, code, family, detail_table, is_custom)
SELECT md5('event-type:' || code)::uuid, NULL, code, family, detail_table,
       code = 'CUSTOM_EVENT_RECORDED'
FROM source ON CONFLICT DO NOTHING;

WITH source(code, name, value_type, unit_code, description, expression_ast) AS (VALUES
  ('AGE_DAYS', 'Возраст, дней', 'INTEGER', 'DAY', 'Возраст на дату среза', '{"op":"date_diff","from":"birth_date","to":"as_of"}'::jsonb),
  ('LACTATION_NUMBER', 'Номер лактации', 'INTEGER', NULL, 'Количество отёлов', '{"op":"count","event":"CALVED"}'::jsonb),
  ('DAYS_IN_MILK', 'Дни в молоке', 'INTEGER', 'DAY', 'Дни после последнего отёла', '{"op":"date_diff","from":"last_calving","to":"as_of"}'::jsonb),
  ('DAYS_SINCE_INSEMINATION', 'Дни после осеменения', 'INTEGER', 'DAY', 'Дни после последнего осеменения', '{"op":"date_diff","from":"last_insemination","to":"as_of"}'::jsonb),
  ('EXPECTED_CALVING_DATE', 'Ожидаемый отёл', 'DATE', NULL, 'Дата осеменения плюс норматив стельности', '{"op":"add_rule","field":"last_insemination","rule":"GESTATION_DAYS"}'::jsonb),
  ('EXPECTED_DRY_OFF_DATE', 'Ожидаемый сухостой', 'DATE', NULL, 'Ожидаемый отёл минус сухостойный период', '{"op":"subtract_rule","field":"EXPECTED_CALVING_DATE","rule":"DRY_PERIOD_DAYS"}'::jsonb),
  ('LAST_MILK_KG', 'Последний надой', 'NUMERIC', 'KG', 'Последний суточный надой', '{"op":"latest","event":"DAILY_MILK_RECORDED","value":"milk_kg"}'::jsonb),
  ('LAST_WEIGHT_KG', 'Последний вес', 'NUMERIC', 'KG', 'Последнее измерение веса', '{"op":"latest","event":"MEASURED","where":{"measurement_code":"WEIGHT"}}'::jsonb)
)
INSERT INTO field_definition(id, farm_id, code, name, scope, value_type, unit_code, source_kind, source_path, is_system)
SELECT md5('field:' || code)::uuid, NULL, code, name, 'ANIMAL', value_type, unit_code,
       'CALCULATED', expression_ast::text, true FROM source
ON CONFLICT DO NOTHING;

WITH source(code, description, expression_ast) AS (VALUES
  ('AGE_DAYS', 'Возраст на дату среза', '{"op":"date_diff","from":"birth_date","to":"as_of"}'::jsonb),
  ('LACTATION_NUMBER', 'Количество отёлов', '{"op":"count","event":"CALVED"}'::jsonb),
  ('DAYS_IN_MILK', 'Дни после последнего отёла', '{"op":"date_diff","from":"last_calving","to":"as_of"}'::jsonb),
  ('DAYS_SINCE_INSEMINATION', 'Дни после последнего осеменения', '{"op":"date_diff","from":"last_insemination","to":"as_of"}'::jsonb),
  ('EXPECTED_CALVING_DATE', 'Осеменение плюс норматив стельности', '{"op":"add_rule","field":"last_insemination","rule":"GESTATION_DAYS"}'::jsonb),
  ('EXPECTED_DRY_OFF_DATE', 'Отёл минус сухостойный период', '{"op":"subtract_rule","field":"EXPECTED_CALVING_DATE","rule":"DRY_PERIOD_DAYS"}'::jsonb),
  ('LAST_MILK_KG', 'Последний суточный надой', '{"op":"latest","event":"DAILY_MILK_RECORDED","value":"milk_kg"}'::jsonb),
  ('LAST_WEIGHT_KG', 'Последний вес', '{"op":"latest","event":"MEASURED","value":"value_numeric"}'::jsonb)
)
INSERT INTO calculated_field(id, field_definition_id, version, expression_ast, description, valid_from)
SELECT md5('calculated-field:' || source.code || ':1')::uuid, fd.id, 1,
       source.expression_ast, source.description, '2020-01-01Z'
FROM source JOIN field_definition fd ON fd.code = source.code AND fd.farm_id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO calculated_field_dependency(calculated_field_id, depends_on_field_id)
SELECT md5('calculated-field:EXPECTED_DRY_OFF_DATE:1')::uuid, md5('field:EXPECTED_CALVING_DATE')::uuid
ON CONFLICT DO NOTHING;
