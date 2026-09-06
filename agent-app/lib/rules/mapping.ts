import { type FieldRegistry, farmFields } from "../farm/fields";
import type { FilterScalar } from "../farm/types";
import type { RuleBinding } from "./source-types";

/** Explicit synthetic binding aliases. Never infer aliases by edit distance/case. */
export const sourceFieldAliases: Readonly<Record<string, string>> = {
  "Вес последний": "lastWeightKg",
  "Возраст в днях": "ageDays",
  "Возраст, дней": "ageDays",
  "Дата 2 осеменения тек.лакт": "secondInseminationDate",
  "Дата геномной оценки": "genomicEvaluationDate",
  "Дата ожидаемого запуска": "expectedDryOffDate",
  "Дата ожидаемого отела": "expectedCalvingDate",
  "Дата отела": "lastCalvingAt",
  "Дата посл. осеменения": "lastInseminationAt",
  "Дата посл. отела": "lastCalvingAt",
  "Дата последнего осеменения": "lastInseminationAt",
  "Дата рождения": "birthDate",
  "Дней доения": "daysInMilk",
  "Дней на пресинге": "daysOnPresynch",
  "Дней с последнего отела": "daysInMilk",
  "Дней стельности": "pregnancyDays",
  "Дни в доении": "daysInMilk",
  "Дни доения": "daysInMilk",
  "Дни доения при 2 осем тек.лакт": "daysInMilkAtSecondInsemination",
  "Дни с осеменения": "daysSinceInsemination",
  "Дни стельности": "pregnancyDays",
  Кличка: "name",
  "Комментарий геномной оценки (при наличии)": "genomicEvaluationComment",
  Лактация: "lactationNumber",
  "Название группы": "groupName",
  "Номер Группы": "groupCode",
  "Номер группы": "groupCode",
  "Номер животного": "primaryIdentifier",
  "Номер ушной бирки": "earTag",
  Пол: "sex",
  "Посл. вес": "lastWeightKg",
  "Последний вес": "lastWeightKg",
  "Последний вес кг.": "lastWeightKg",
  "Последний вес.": "lastWeightKg",
  "Прогноз 305M тек.лакт": "forecast305M",
  Статус: "statusCode",
  "Статус животного": "statusCode",
  "Статус коровы": "statusCode",
  "Ушная бирка": "earTag",
};

/** These labels equal the explicitly seeded database status labels. */
const statusValues: Record<string, string> = {
  Бык: "BULL",
  Выбракована: "CULLED",
  "Готов к продаже": "SELL_READY",
  "Готова к осеменению": "READY_FOR_INSEMINATION",
  Дойная: "LACTATING",
  "Не осеменять": "DO_NOT_INSEMINATE",
  Новотельная: "FRESH",
  Осеменена: "INSEMINATED",
  Пала: "DEAD",
  "Поздний сухостой": "LATE_DRY",
  Продана: "SOLD",
  Стельная: "PREGNANT",
  Сухостой: "DRY",
  Тёлка: "HEIFER",
};

export function mapSourceField(
  label: string,
  binding: RuleBinding,
  registry: FieldRegistry = farmFields
) {
  const id = binding.fieldBindings?.[label] ?? sourceFieldAliases[label];
  if (!id || !Object.hasOwn(registry, id)) {
    return;
  }
  const field = registry[id];
  if (field.farmIds && !field.farmIds.includes(binding.farmId)) {
    return;
  }
  return field;
}

export function mapSourceLiteral(
  fieldId: string,
  raw: string,
  binding: RuleBinding
): FilterScalar | undefined {
  const explicit = binding.valueBindings?.[fieldId]?.[raw];
  if (explicit) {
    return explicit;
  }
  if (fieldId === "statusCode" && Object.hasOwn(statusValues, raw)) {
    return { type: "string", value: statusValues[raw] };
  }
}
