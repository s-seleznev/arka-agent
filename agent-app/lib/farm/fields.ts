import type { FilterOperator } from "./types";

export type FarmFieldDefinition = {
  timestamp?: boolean;
  sourceName?: string;
  definitionId?: string;
  definitionVersion?: number;
  sourceCode?: string;
  farmIds?: string[];
  column: boolean;
  editor: "boolean" | "date" | "number" | "select" | "text";
  groupable: boolean;
  id: string;
  label: string;
  operators: FilterOperator[];
  sortable: boolean;
  sql: string;
  type: "boolean" | "date" | "number" | "text";
  unit?: string;
  valueSource: "boolean" | "distinct" | "freeform";
};

const textOperators: FilterOperator[] = [
  "eq",
  "neq",
  "in",
  "not_in",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "is_empty",
  "is_not_empty",
];
const numberOperators: FilterOperator[] = [
  "eq",
  "neq",
  "in",
  "not_in",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "is_empty",
  "is_not_empty",
];
const booleanOperators: FilterOperator[] = ["eq", "neq"];
const dateOperators: FilterOperator[] = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "today",
  "in_last",
  "in_next",
  "is_empty",
  "is_not_empty",
];

const groupableFieldIds = new Set([
  "lastBull",
  "ageBand",
  "sex",
  "groupCode",
  "statusCode",
  "lactationNumber",
  "isPregnant",
  "isArchived",
  "isExited",
]);

const definitions = [
  ["lastDryOffDate", "Дата запуска", "(farm_report_facts(s.animal_id,s.farm_id)->>'lastDryOffDate')::date", "date", dateOperators],
  ["lastBull", "Бык", "(farm_report_facts(s.animal_id,s.farm_id)->>'bull')", "text", textOperators],
  ["lastTechnician", "Техник", "(farm_report_facts(s.animal_id,s.farm_id)->>'technician')", "text", textOperators],
  ["inseminationNumber", "Осеменение №", "(farm_report_facts(s.animal_id,s.farm_id)->>'inseminationNumber')::numeric", "number", numberOperators],
  ["exitDate", "Дата выбытия", "(farm_report_facts(s.animal_id,s.farm_id)->>'exitDate')::date", "date", dateOperators],
  ["exitDaysInMilk", "ДДЛ при выбытии", "(farm_report_facts(s.animal_id,s.farm_id)->>'exitDIM')::numeric", "number", numberOperators],
  ["exitReason", "Причина выбытия", "(farm_report_facts(s.animal_id,s.farm_id)->>'exitReason')", "text", textOperators],
  ["yesterdayMilkKg", "Надой вчера, кг", "(farm_report_facts(s.animal_id,s.farm_id)->>'yesterdayMilk')::numeric", "number", numberOperators],
  ["lastClinicalEvent", "Последнее клиническое событие", "(farm_report_facts(s.animal_id,s.farm_id)->>'lastClinicalEvent')", "text", textOperators],
  ["animalNote", "Комментарий", "(farm_report_facts(s.animal_id,s.farm_id)->>'note')", "text", textOperators],
  ["dailyGainG", "Привес, г/день", "(farm_report_facts(s.animal_id,s.farm_id)->>'gain')::numeric", "number", numberOperators],
  ["activeProtocols", "Протоколы", "(farm_report_facts(s.animal_id,s.farm_id)->>'protocols')", "text", textOperators],
  ["protocolProgress", "День протокола", "(farm_report_facts(s.animal_id,s.farm_id)->>'protocolDay')", "text", textOperators],
  ["nextProtocolDate", "Следующая обработка", "(farm_report_facts(s.animal_id,s.farm_id)->>'nextProtocolDate')::date", "date", dateOperators],
  ["protocolResponsible", "Ответственный", "(farm_report_facts(s.animal_id,s.farm_id)->>'responsible')", "text", textOperators],
  ["ageMonths", "Возраст, мес", "(extract(year FROM age((now() AT TIME ZONE (SELECT timezone FROM farm WHERE id=s.farm_id))::date,s.birth_date))*12+extract(month FROM age((now() AT TIME ZONE (SELECT timezone FROM farm WHERE id=s.farm_id))::date,s.birth_date)))", "number", numberOperators],
  ["ageBand", "Возрастная группа", "CASE WHEN s.birth_date> ((now() AT TIME ZONE (SELECT timezone FROM farm WHERE id=s.farm_id))::date-interval '15 months')::date THEN '12–14 мес' ELSE '15+ мес' END", "text", textOperators],
  ["saleReadiness", "Готовность к продаже", "CASE WHEN s.sex='MALE' AND s.age_days>=14 AND s.last_weight_kg>=50 THEN 'Готов' ELSE 'Ожидание' END", "text", textOperators],
  ["primaryIdentifier", "Номер", "s.primary_identifier", "text", textOperators],
  ["name", "Кличка", "s.name", "text", textOperators],
  ["sex", "Пол", "s.sex", "text", textOperators],
  ["birthDate", "Дата рождения", "s.birth_date", "date", dateOperators],
  ["ageDays", "Возраст, дней", "s.age_days", "number", numberOperators],
  ["groupCode", "Группа", "s.group_code", "text", textOperators],
  ["statusCode", "Статус", "s.status_code", "text", textOperators],
  [
    "lactationNumber",
    "Лактация",
    "s.lactation_number",
    "number",
    numberOperators,
  ],
  ["daysInMilk", "Дней в молоке", "s.days_in_milk", "number", numberOperators],
  [
    "lastCalvingAt",
    "Последний отёл",
    "s.last_calving_at",
    "date",
    dateOperators,
  ],
  [
    "lastInseminationAt",
    "Последнее осеменение",
    "s.last_insemination_at",
    "date",
    dateOperators,
  ],
  ["isPregnant", "Стельная", "s.is_pregnant", "boolean", booleanOperators],
  [
    "pregnancyDays",
    "Дней стельности",
    "s.pregnancy_days",
    "number",
    numberOperators,
  ],
  [
    "expectedCalvingDate",
    "Ожидаемый отёл",
    "s.expected_calving_date",
    "date",
    dateOperators,
  ],
  [
    "expectedDryOffDate",
    "Ожидаемый сухостой",
    "s.expected_dry_off_date",
    "date",
    dateOperators,
  ],
  [
    "lastMilkKg",
    "Последний надой",
    "s.last_milk_kg",
    "number",
    numberOperators,
    "кг",
  ],
  [
    "lastWeightKg",
    "Последний вес",
    "s.last_weight_kg",
    "number",
    numberOperators,
    "кг",
  ],
  [
    "activeDiagnosisCount",
    "Активные диагнозы",
    "s.active_diagnosis_count",
    "number",
    numberOperators,
  ],
  [
    "activeProtocolCount",
    "Активные протоколы",
    "s.active_protocol_count",
    "number",
    numberOperators,
  ],
  [
    "activeWithdrawalCount",
    "Активные ограничения",
    "s.active_withdrawal_count",
    "number",
    numberOperators,
  ],
  ["isArchived", "В архиве", "s.is_archived", "boolean", booleanOperators],
  ["isExited", "Выбыло", "s.is_exited", "boolean", booleanOperators],
] as const;

export const farmFields = Object.fromEntries(
  definitions.map(([id, label, sql, type, operators, unit]) => [
    id,
    {
      column: true,
      editor:
        type === "boolean"
          ? "boolean"
          : type === "date"
            ? "date"
            : type === "number"
              ? "number"
              : groupableFieldIds.has(id)
                ? "select"
                : "text",
      groupable: groupableFieldIds.has(id),
      id,
      label,
      operators: [...operators],
      sortable: true,
      sql,
      type,
      unit:
        unit ??
        (
          {
            activeDiagnosisCount: "диагнозов",
            activeProtocolCount: "протоколов",
            activeWithdrawalCount: "ограничений",
            ageDays: "дней",
            daysInMilk: "дней",
            lactationNumber: "номер лактации",
            pregnancyDays: "дней",
          } as Record<string, string>
        )[id],
      valueSource:
        type === "boolean"
          ? "boolean"
          : groupableFieldIds.has(id)
            ? "distinct"
            : "freeform",
    },
  ])
) as Record<string, FarmFieldDefinition>;

farmFields.farmId = {
  column: false,
  editor: "select",
  groupable: false,
  id: "farmId",
  label: "Ферма",
  operators: ["eq", "neq", "in", "not_in"],
  sortable: false,
  sql: "s.farm_id::text",
  type: "text",
  valueSource: "distinct",
};

// Trusted projections registered by additive farm migrations, never SQL from CSV.
const ruleDefinitions = [
  [
    "daysSinceInsemination",
    "Дней после осеменения",
    "DAYS_SINCE_INSEMINATION",
    "number",
    "дней",
  ],
  ["daysOnPresynch", "Дней на пресинге", "DAYS_ON_PRESYNCH", "number", "дней"],
  [
    "secondInseminationDate",
    "Второе осеменение текущей лактации",
    "SECOND_INSEMINATION_DATE_CURRENT_LACTATION",
    "date",
    undefined,
  ],
  [
    "daysInMilkAtSecondInsemination",
    "Дней доения при втором осеменении",
    "DAYS_IN_MILK_AT_SECOND_INSEMINATION",
    "number",
    "дней",
  ],
  [
    "genomicEvaluationDate",
    "Дата геномной оценки",
    "GENOMIC_EVALUATION_DATE",
    "date",
    undefined,
  ],
  [
    "genomicEvaluationComment",
    "Комментарий геномной оценки",
    "GENOMIC_EVALUATION_COMMENT",
    "text",
    undefined,
  ],
  [
    "forecast305M",
    "Прогноз 305M текущей лактации",
    "FORECAST_305M_CURRENT_LACTATION",
    "number",
    "кг",
  ],
  ["lifeState", "Жизненное состояние", "LIFE_STATE", "text", undefined],
  ["groupName", "Название группы", "GROUP_NAME", "text", undefined],
  ["earTag", "Ушная бирка", "EAR_TAG", "text", undefined],
] as const;

for (const [id, label, code, type, unit] of ruleDefinitions) {
  const cast =
    type === "number" ? "::numeric" : type === "date" ? "::date" : "";
  farmFields[id] = {
    column: true,
    editor: type === "number" ? "number" : type === "date" ? "date" : "text",
    groupable: type !== "number",
    id,
    label,
    operators: [
      ...(type === "number"
        ? numberOperators
        : type === "date"
          ? dateOperators
          : textOperators),
    ],
    sortable: true,
    sql: `(s.rule_values->>'${code}')${cast}`,
    type,
    unit,
    valueSource:
      type === "text" && id !== "genomicEvaluationComment"
        ? "distinct"
        : "freeform",
  };
}

export const defaultAnimalColumns = [
  "primaryIdentifier",
  "name",
  "groupCode",
  "statusCode",
  "lactationNumber",
  "isPregnant",
  "lastMilkKg",
];

export type FieldRegistry = Readonly<Record<string, FarmFieldDefinition>>;

export function requireFarmField(
  id: string,
  registry: FieldRegistry = farmFields
): FarmFieldDefinition {
  const field = Object.hasOwn(registry, id) ? registry[id] : undefined;
  if (!field) {
    throw new Error(`UNKNOWN_FARM_FIELD:${id}`);
  }
  return field;
}
