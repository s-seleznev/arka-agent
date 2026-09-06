// biome-ignore-all lint/complexity/noVoid: Event handlers intentionally launch self-contained async UI work.
// biome-ignore-all lint/performance/noJsxPropsBind: This interactive editor binds handlers to node-specific controls.
"use client";

import {
  ArrowDownIcon,
  ArrowDownNarrowWideIcon,
  ArrowUpIcon,
  CheckIcon,
  Columns3Icon,
  ChevronsUpDownIcon,
  FilterIcon,
  GripVerticalIcon,
  ListTreeIcon,
  PlusIcon,
  RotateCcwIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import {
  type ChangeEvent,
  type ComponentProps,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import useSWR from "swr";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { compareDecimals } from "@/lib/farm/decimal";
import type {
  FilterCondition,
  FilterGroup,
  FilterNode,
  FilterOperator,
  FilterScalar,
  FilterValue,
  GroupRule,
  SortRule,
  ViewOperation,
} from "@/lib/farm/types";
import {
  filterScalarSchema,
  MAX_FILTER_CONDITIONS,
  MAX_GROUP_RULES,
} from "@/lib/farm/types";
import { cn } from "@/lib/utils";

export type TableField = {
  column: boolean;
  editor: "boolean" | "date" | "number" | "select" | "text";
  groupable: boolean;
  id: string;
  label: string;
  operators: FilterOperator[];
  options?: Array<{ label: string; value: FilterScalar }>;
  sortable: boolean;
  type: "boolean" | "date" | "number" | "text";
  unit?: string;
  valueSource: "boolean" | "distinct" | "freeform";
};

type TableViewControlsProps = {
  columns: string[];
  fields: TableField[];
  filters: FilterGroup;
  groupBy: GroupRule[];
  isMutating?: boolean;
  onOperations: (operations: ViewOperation[]) => Promise<void> | void;
  sort: SortRule[];
  viewId: string;
};

type BackgroundMutation = { kind: "operations"; operations: ViewOperation[] };

const operatorLabels: Record<FilterOperator, string> = {
  between: "между",
  contains: "содержит",
  ends_with: "заканчивается на",
  eq: "равно",
  gt: "больше",
  gte: "не меньше",
  in: "в списке",
  in_last: "за последние",
  in_next: "в следующие",
  is_empty: "пусто",
  is_not_empty: "не пусто",
  lt: "меньше",
  lte: "не больше",
  neq: "не равно",
  not_contains: "не содержит",
  not_in: "не в списке",
  starts_with: "начинается с",
  today: "сегодня",
};

const EMPTY_VALUE_OPERATORS = new Set<FilterOperator>([
  "is_empty",
  "is_not_empty",
  "today",
]);
const MAX_RELATIVE_PERIOD = 3650;

function makeId(_prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  throw new Error("CRYPTO_RANDOM_UUID_UNAVAILABLE");
}

function cloneFilter(condition: FilterCondition): FilterCondition {
  return structuredClone(condition);
}

function collectFilterConditions(node: FilterNode): FilterCondition[] {
  return node.kind === "condition"
    ? [node]
    : node.children.flatMap(collectFilterConditions);
}

function scalarFromRaw(
  field: TableField,
  raw: string,
  exact = false
): FilterScalar | null {
  if (field.type === "number") {
    const decimal = filterScalarSchema.safeParse({
      type: "decimal",
      value: raw.trim(),
    });
    if (!decimal.success) {
      return null;
    }
    if (exact) {
      return decimal.data;
    }
    const numeric = Number(raw);
    return Number.isFinite(numeric) &&
      compareDecimals(raw.trim(), String(numeric)) === 0
      ? { type: "number", value: numeric }
      : decimal.data;
  }
  if (field.type === "boolean") {
    return { type: "boolean", value: raw === "true" };
  }
  if (raw.trim() === "") {
    return null;
  }
  return field.type === "date"
    ? { type: "date", value: raw.trim() }
    : { type: "string", value: raw.trim() };
}

function scalarKey(value: FilterScalar) {
  return JSON.stringify(value);
}

function useFieldOptions(viewId: string, field: TableField | undefined) {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const shouldFetch = field?.valueSource === "distinct";
  const { data, error, isLoading, mutate } = useSWR<{
    values: FilterScalar[];
  }>(
    shouldFetch && field ? ["farm-field-values", viewId, field.id] : null,
    async () => {
      const response = await fetch(`${base}/api/farm/field-values`, {
        body: JSON.stringify({ fieldId: field?.id, limit: 200, viewId }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("FIELD_VALUES_FAILED");
      }
      return response.json();
    },
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );
  const options = useMemo(() => {
    if (field?.options) {
      return field.options;
    }
    if (!field) {
      return [];
    }
    return (data?.values ?? []).map((value) => ({
      label: formatScalar(value),
      value,
    }));
  }, [data?.values, field]);
  const retry = useCallback(() => mutate(), [mutate]);
  return {
    error: error instanceof Error ? error : null,
    isLoading,
    options,
    retry,
  };
}

function valueFromRaw(
  field: TableField,
  operator: FilterOperator,
  raw: string,
  upperRaw: string,
  original?: FilterValue
): FilterValue | undefined {
  if (EMPTY_VALUE_OPERATORS.has(operator)) {
    return;
  }
  if (operator === "in_last" || operator === "in_next") {
    const amount = Number(raw);
    return Number.isInteger(amount) &&
      amount > 0 &&
      amount <= MAX_RELATIVE_PERIOD
      ? { amount, type: "relative_date", unit: "day" }
      : undefined;
  }
  if (operator === "between") {
    const lower = scalarFromRaw(
      field,
      raw,
      original?.type === "range" && original.lower.type === "decimal"
    );
    const upper = scalarFromRaw(
      field,
      upperRaw,
      original?.type === "range" && original.upper.type === "decimal"
    );
    return lower === null || upper === null
      ? undefined
      : { lower, type: "range", upper };
  }
  if (operator === "in" || operator === "not_in") {
    const values = raw
      .split(",")
      .map((item) =>
        scalarFromRaw(
          field,
          item,
          original?.type === "list" &&
            original.values.some((value) => value.type === "decimal")
        )
      );
    if (values.length === 0 || values.some((value) => value === null)) {
      return;
    }
    return {
      type: "list",
      values: values.filter((value): value is FilterScalar => value !== null),
    };
  }
  const scalar = scalarFromRaw(field, raw, original?.type === "decimal");
  if (scalar === null) {
    return;
  }
  if (field.type === "boolean") {
    return scalar;
  }
  if (field.type === "number") {
    return scalar;
  }
  if (field.type === "date") {
    return scalar;
  }
  return scalar;
}

function defaultFilterValue(operator: FilterOperator): FilterValue | undefined {
  if (EMPTY_VALUE_OPERATORS.has(operator)) {
    return;
  }
  if (operator === "in_last" || operator === "in_next") {
    return { amount: 1, type: "relative_date", unit: "day" };
  }
}

function FieldPicker({
  ariaLabel,
  fields,
  id,
  onValueChange,
  testId,
  value,
}: {
  ariaLabel: string;
  fields: TableField[];
  id: string;
  onValueChange: (value: string) => void;
  testId?: string;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = fields.find((field) => field.id === value);
  const listId = `${id}-list`;

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button
          aria-controls={listId}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={ariaLabel}
          className="w-full justify-between"
          data-testid={testId}
          role="combobox"
          size="sm"
          variant="outline"
        >
          <span className="truncate">{selected?.label ?? "Выберите поле"}</span>
          <ChevronsUpDownIcon className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="bg-background [&_[data-slot=command]]:bg-background w-[var(--radix-popover-trigger-width)] p-0"
        id={listId}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          searchRef.current?.focus();
        }}
      >
        <Command>
          <CommandInput
            aria-label={`${ariaLabel}: поиск`}
            data-field-search
            data-testid={testId ? `${testId}-search` : undefined}
            placeholder="Найти поле…"
            ref={searchRef}
          />
          <CommandList>
            <CommandEmpty>Поля не найдены.</CommandEmpty>
            <CommandGroup>
              {fields.map((field) => (
                <CommandItem
                  key={field.id}
                  onSelect={() => {
                    onValueChange(field.id);
                    setOpen(false);
                  }}
                  value={`${field.label} ${field.id}`}
                >
                  <CheckIcon
                    className={cn(
                      "opacity-0",
                      field.id === value && "opacity-100"
                    )}
                  />
                  {field.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function rawFromValue(value: FilterValue | undefined, part: "lower" | "main") {
  if (!value) {
    return "";
  }
  if (value.type === "range") {
    return String((part === "lower" ? value.lower : value.upper).value);
  }
  if (value.type === "list") {
    return value.values.map((item) => String(item.value)).join(", ");
  }
  if (value.type === "relative_date") {
    return String(value.amount);
  }
  if (value.type === "relative_day") {
    return String(value.offset);
  }
  if (value.type === "field") {
    return value.field;
  }
  return String(value.value);
}

function isValueValid(
  field: TableField | undefined,
  operator: FilterOperator,
  value: FilterValue | undefined,
  fieldMap?: Map<string, TableField>
) {
  if (EMPTY_VALUE_OPERATORS.has(operator)) {
    return true;
  }
  if (!(field && value)) {
    return false;
  }
  if (operator === "between") {
    if (value.type !== "range") {
      return false;
    }
    if (field.type === "number") {
      return (
        compareDecimals(String(value.lower.value), String(value.upper.value)) <=
        0
      );
    }
    return String(value.lower.value) <= String(value.upper.value);
  }
  if (operator === "in" || operator === "not_in") {
    return value.type === "list" && value.values.length > 0;
  }
  if (operator === "in_last" || operator === "in_next") {
    return (
      value.type === "relative_date" &&
      Number.isInteger(value.amount) &&
      value.amount > 0 &&
      value.amount <= MAX_RELATIVE_PERIOD
    );
  }
  if (value.type === "relative_day") {
    return (
      field.type === "date" &&
      Number.isInteger(value.offset) &&
      Math.abs(value.offset) <= 36_500
    );
  }
  if (value.type === "field") {
    const referenced = fieldMap?.get(value.field);
    return Boolean(
      referenced &&
        field.id !== "farmId" &&
        referenced.id !== "farmId" &&
        referenced.type === field.type &&
        referenced.unit === field.unit
    );
  }
  return value.type === "string" ||
    value.type === "date" ||
    value.type === "number" ||
    value.type === "decimal" ||
    value.type === "boolean"
    ? String(value.value).trim() !== ""
    : false;
}

function formatScalar(value: FilterScalar) {
  if (value.type === "boolean") {
    return value.value ? "Да" : "Нет";
  }
  return String(value.value);
}

function formatFilterScalar(value: FilterScalar, field?: TableField) {
  return (
    field?.options?.find(
      (option) => scalarKey(option.value) === scalarKey(value)
    )?.label ?? formatScalar(value)
  );
}

function formatFilterValue(
  value: FilterValue | undefined,
  field?: TableField,
  fieldMap?: Map<string, TableField>
) {
  if (!value) {
    return "";
  }
  if (value.type === "list") {
    return value.values
      .map((item) => formatFilterScalar(item, field))
      .join(", ");
  }
  if (value.type === "range") {
    return `${formatFilterScalar(value.lower, field)} — ${formatFilterScalar(value.upper, field)}`;
  }
  if (value.type === "relative_date") {
    return `${value.amount} ${value.unit}`;
  }
  if (value.type === "field") {
    return `поле «${fieldMap?.get(value.field)?.label ?? value.field}»`;
  }
  if (value.type === "relative_day") {
    return value.offset === 0
      ? "сегодня"
      : `сегодня ${value.offset < 0 ? "−" : "+"} ${Math.abs(value.offset)} дн.`;
  }
  return formatFilterScalar(value, field);
}

function conditionLabel(
  condition: FilterCondition,
  fieldMap: Map<string, TableField>
) {
  const field = fieldMap.get(condition.field);
  const value = formatFilterValue(condition.value, field, fieldMap);
  const label = `${field?.label ?? condition.field} ${operatorLabels[condition.operator]}${value ? ` ${value}` : ""}`;
  return condition.negated ? `НЕ ${label}` : label;
}

function getDefaultCondition(): FilterCondition {
  return {
    field: "",
    id: makeId("filter"),
    kind: "condition",
    negated: false,
    operator: "eq",
  };
}

function ValueEditor({
  condition,
  describedBy,
  field,
  idPrefix,
  invalid = false,
  onChange,
  onCommit,
  viewId,
}: {
  condition: FilterCondition;
  describedBy?: string;
  field: TableField | undefined;
  idPrefix: string;
  invalid?: boolean;
  onChange: (value: FilterValue | undefined) => void;
  onCommit?: (value: FilterValue | undefined) => void;
  viewId: string;
}) {
  const [raw, setRaw] = useState(() => rawFromValue(condition.value, "lower"));
  const [upperRaw, setUpperRaw] = useState(() =>
    rawFromValue(condition.value, "main")
  );
  const {
    error: optionsError,
    isLoading: optionsLoading,
    options,
    retry: retryOptions,
  } = useFieldOptions(viewId, field);
  const pendingCommitRef = useRef<FilterValue | undefined>(condition.value);
  const multipleDirtyRef = useRef(false);
  const optionsErrorId = `${idPrefix}-options-error`;
  const valueDescription = [describedBy, optionsError ? optionsErrorId : null]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    setRaw(rawFromValue(condition.value, "lower"));
    setUpperRaw(rawFromValue(condition.value, "main"));
    pendingCommitRef.current = condition.value;
  }, [condition.value]);

  const commit = useCallback(
    (nextRaw: string, nextUpperRaw: string) => {
      if (field) {
        onChange(
          valueFromRaw(
            field,
            condition.operator,
            nextRaw,
            nextUpperRaw,
            condition.value
          )
        );
      }
    },
    [condition.operator, condition.value, field, onChange]
  );
  const handleRawChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const next = event.target.value;
      setRaw(next);
      commit(next, upperRaw);
    },
    [commit, upperRaw]
  );
  const handleUpperChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const next = event.target.value;
      setUpperRaw(next);
      commit(raw, next);
    },
    [commit, raw]
  );

  if (!field || EMPTY_VALUE_OPERATORS.has(condition.operator)) {
    return null;
  }
  if (condition.operator === "in_last" || condition.operator === "in_next") {
    const relative =
      condition.value?.type === "relative_date"
        ? condition.value
        : { amount: 1, type: "relative_date" as const, unit: "day" as const };
    return (
      <div className="flex min-w-0 items-center gap-2">
        <Input
          aria-describedby={valueDescription || undefined}
          aria-invalid={invalid}
          aria-label="Количество периодов"
          className="h-8 min-w-24 flex-1"
          data-testid="farm-filter-value"
          max={MAX_RELATIVE_PERIOD}
          min={1}
          onBlur={(event) => {
            const amount = Number(event.currentTarget.value);
            onCommit?.(
              Number.isInteger(amount) &&
                amount > 0 &&
                amount <= MAX_RELATIVE_PERIOD
                ? { ...relative, amount }
                : undefined
            );
          }}
          onChange={(event) => {
            const amount = Number(event.target.value);
            const nextValue =
              Number.isInteger(amount) &&
              amount > 0 &&
              amount <= MAX_RELATIVE_PERIOD
                ? { ...relative, amount }
                : undefined;
            pendingCommitRef.current = nextValue;
            onChange(nextValue);
          }}
          type="number"
          value={relative.amount}
        />
        <Select
          onValueChange={(unit) => {
            const nextValue = {
              ...relative,
              unit: unit as "day" | "month" | "week",
            };
            pendingCommitRef.current = nextValue;
            onChange(nextValue);
            onCommit?.(nextValue);
          }}
          value={relative.unit}
        >
          <SelectTrigger
            aria-describedby={valueDescription || undefined}
            aria-invalid={invalid}
            aria-label="Единица периода"
            size="sm"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="day">дней</SelectItem>
              <SelectItem value="week">недель</SelectItem>
              <SelectItem value="month">месяцев</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    );
  }
  if (field.type === "boolean") {
    const currentBoolean =
      condition.value?.type === "boolean"
        ? String(condition.value.value)
        : undefined;
    return (
      <Select
        onValueChange={(next) => {
          const nextValue = {
            type: "boolean" as const,
            value: next === "true",
          };
          pendingCommitRef.current = nextValue;
          onChange(nextValue);
          onCommit?.(nextValue);
        }}
        value={currentBoolean ?? ""}
      >
        <SelectTrigger
          aria-describedby={valueDescription || undefined}
          aria-invalid={invalid}
          aria-label="Значение"
          data-testid="farm-filter-value"
          size="sm"
        >
          <SelectValue placeholder="Выберите значение" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="true">Да</SelectItem>
            <SelectItem value="false">Нет</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    );
  }

  const usesOptions =
    ["eq", "neq", "in", "not_in"].includes(condition.operator) &&
    (field.editor === "select" || field.valueSource === "distinct");
  if (usesOptions) {
    if (optionsError) {
      return (
        <div className="flex min-w-0 flex-col gap-2">
          <Button
            aria-describedby={optionsErrorId}
            aria-invalid="true"
            className="justify-start"
            data-testid="farm-filter-value"
            disabled
            size="sm"
            variant="outline"
          >
            Значения недоступны
          </Button>
          <div
            className="flex items-center gap-2 text-destructive text-xs"
            id={optionsErrorId}
            role="alert"
          >
            <span>Не удалось загрузить значения поля.</span>
            <Button
              data-testid="farm-field-values-retry"
              onClick={() => retryOptions()}
              size="xs"
              type="button"
              variant="outline"
            >
              <RotateCcwIcon data-icon="inline-start" />
              Повторить
            </Button>
          </div>
        </div>
      );
    }
    if (condition.operator === "in" || condition.operator === "not_in") {
      const selected =
        condition.value?.type === "list" ? condition.value.values : [];
      return (
        <DropdownMenu
          modal={false}
          onOpenChange={(open) => {
            if (!(open || !multipleDirtyRef.current)) {
              multipleDirtyRef.current = false;
              onCommit?.(pendingCommitRef.current);
            }
          }}
        >
          <DropdownMenuTrigger asChild>
            <Button
              aria-describedby={valueDescription || undefined}
              aria-invalid={invalid}
              aria-label="Значения фильтра"
              className="min-w-36 justify-between"
              data-testid="farm-filter-value"
              size="sm"
              variant="outline"
            >
              {optionsLoading
                ? "Загрузка…"
                : selected.length > 0
                  ? `Выбрано: ${selected.length}`
                  : "Выберите значения"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="bg-background [&_[data-slot=command]]:bg-background max-h-72 min-w-64 overflow-y-auto">
            <DropdownMenuGroup>
              {options.map((option) => {
                const checked = selected.some(
                  (value) => scalarKey(value) === scalarKey(option.value)
                );
                return (
                  <DropdownMenuCheckboxItem
                    checked={checked}
                    key={scalarKey(option.value)}
                    onCheckedChange={() => {
                      const values = checked
                        ? selected.filter(
                            (value) =>
                              scalarKey(value) !== scalarKey(option.value)
                          )
                        : [...selected, option.value];
                      const nextValue =
                        values.length > 0
                          ? ({ type: "list", values } as const)
                          : undefined;
                      pendingCommitRef.current = nextValue;
                      multipleDirtyRef.current = true;
                      onChange(nextValue);
                    }}
                    onSelect={(event) => event.preventDefault()}
                  >
                    {option.label}
                  </DropdownMenuCheckboxItem>
                );
              })}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }
    const currentScalar =
      condition.value &&
      condition.value.type !== "list" &&
      condition.value.type !== "range" &&
      condition.value.type !== "relative_date" &&
      condition.value.type !== "relative_day" &&
      condition.value.type !== "field"
        ? condition.value
        : undefined;
    return (
      <Select
        onValueChange={(key) => {
          const nextValue = options.find(
            (option) => scalarKey(option.value) === key
          )?.value;
          pendingCommitRef.current = nextValue;
          onChange(nextValue);
          onCommit?.(nextValue);
        }}
        value={currentScalar ? scalarKey(currentScalar) : ""}
      >
        <SelectTrigger
          aria-describedby={valueDescription || undefined}
          aria-invalid={invalid}
          aria-label="Значение фильтра"
          className="min-w-36"
          data-testid="farm-filter-value"
          size="sm"
        >
          <SelectValue
            placeholder={optionsLoading ? "Загрузка…" : "Выберите значение"}
          />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem
                key={scalarKey(option.value)}
                value={scalarKey(option.value)}
              >
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    );
  }

  const inputType = field.type === "date" ? "date" : "text";
  const placeholder =
    condition.operator === "in" || condition.operator === "not_in"
      ? "Значения через запятую"
      : "Значение";

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Input
        aria-describedby={valueDescription || undefined}
        aria-invalid={invalid}
        aria-label={
          condition.operator === "between"
            ? "Нижняя граница"
            : "Значение фильтра"
        }
        className="h-8 min-w-32 flex-1"
        data-testid="farm-filter-value"
        id={`${idPrefix}-value`}
        inputMode={field.type === "number" ? "decimal" : undefined}
        onBlur={() =>
          onCommit?.(
            valueFromRaw(
              field,
              condition.operator,
              raw,
              upperRaw,
              condition.value
            )
          )
        }
        onChange={handleRawChange}
        placeholder={placeholder}
        type={inputType}
        value={raw}
      />
      {condition.operator === "between" ? (
        <>
          <span aria-hidden="true" className="text-muted-foreground text-xs">
            —
          </span>
          <Input
            aria-describedby={valueDescription || undefined}
            aria-invalid={invalid}
            aria-label="Верхняя граница"
            className="h-8 min-w-32 flex-1"
            data-testid="farm-filter-value-upper"
            id={`${idPrefix}-value-upper`}
            inputMode={field.type === "number" ? "decimal" : undefined}
            onBlur={() =>
              onCommit?.(
                valueFromRaw(
                  field,
                  condition.operator,
                  raw,
                  upperRaw,
                  condition.value
                )
              )
            }
            onChange={handleUpperChange}
            placeholder="До"
            type={inputType}
            value={upperRaw}
          />
        </>
      ) : null}
    </div>
  );
}

function FilterOperandEditor({
  fields,
  ...props
}: ComponentProps<typeof ValueEditor> & { fields: TableField[] }) {
  const { condition, field, onChange, onCommit, invalid, describedBy } = props;
  const [mode, setMode] = useState<"literal" | "field" | "relative_day">(() =>
    condition.value?.type === "field" ||
    condition.value?.type === "relative_day"
      ? condition.value.type
      : "literal"
  );
  const [offsetRaw, setOffsetRaw] = useState(() =>
    condition.value?.type === "relative_day"
      ? String(condition.value.offset)
      : "0"
  );
  const comparison = ["eq", "neq", "gt", "gte", "lt", "lte"].includes(
    condition.operator
  );
  const compatible = fields.filter(
    (candidate) =>
      candidate.id !== "farmId" &&
      candidate.type === field?.type &&
      candidate.unit === field?.unit
  );
  useEffect(() => {
    if (
      condition.value?.type === "field" ||
      condition.value?.type === "relative_day"
    ) {
      setMode(condition.value.type);
      if (condition.value.type === "relative_day") {
        setOffsetRaw(String(condition.value.offset));
      }
    }
  }, [condition.value]);
  if (!field || !comparison || field.id === "farmId") {
    return <ValueEditor {...props} />;
  }
  const relativeValue = (raw: string): FilterValue | undefined => {
    const offset = Number(raw);
    return raw.trim() !== "" &&
      Number.isInteger(offset) &&
      Math.abs(offset) <= 36_500
      ? { offset, type: "relative_day" }
      : undefined;
  };
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Select
        onValueChange={(next) => {
          const nextMode = next as typeof mode;
          setMode(nextMode);
          if (nextMode === "relative_day") {
            setOffsetRaw("0");
            onChange({ offset: 0, type: "relative_day" });
          } else {
            onChange(undefined);
          }
        }}
        value={mode}
      >
        <SelectTrigger
          aria-label="Сравнить с"
          data-testid="farm-filter-operand-kind"
          size="sm"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="literal">Значение</SelectItem>
            {compatible.length > 0 ? (
              <SelectItem value="field">Другое поле</SelectItem>
            ) : null}
            {field.type === "date" ? (
              <SelectItem value="relative_day">Относительно сегодня</SelectItem>
            ) : null}
          </SelectGroup>
        </SelectContent>
      </Select>
      {mode === "field" ? (
        <FieldPicker
          ariaLabel="Поле для сравнения"
          fields={compatible}
          id={`${props.idPrefix}-operand-field`}
          onValueChange={(selected) => {
            const value = { field: selected, type: "field" as const };
            onChange(value);
            onCommit?.(value);
          }}
          testId="farm-filter-operand-field"
          value={condition.value?.type === "field" ? condition.value.field : ""}
        />
      ) : mode === "relative_day" ? (
        <>
          <Input
            aria-describedby={describedBy}
            aria-invalid={invalid}
            aria-label="Смещение от сегодня, дней"
            data-testid="farm-filter-relative-day"
            max={36_500}
            min={-36_500}
            onBlur={() => onCommit?.(relativeValue(offsetRaw))}
            onChange={(event) => {
              setOffsetRaw(event.target.value);
              onChange(relativeValue(event.target.value));
            }}
            step={1}
            type="number"
            value={offsetRaw}
          />
          <p className="text-muted-foreground text-xs">
            Отрицательное число — дней назад, положительное — дней вперёд. 0 —
            сегодня.
          </p>
        </>
      ) : (
        <ValueEditor {...props} />
      )}
    </div>
  );
}

function SimpleFilterEditor({
  canAdd,
  fields,
  initialCondition,
  onCancel,
  onSubmit,
  viewId,
}: {
  canAdd: boolean;
  fields: TableField[];
  initialCondition?: FilterCondition | null;
  onCancel: () => void;
  onSubmit: (condition: FilterCondition) => Promise<void> | void;
  viewId: string;
}) {
  const [condition, setCondition] = useState<FilterCondition>(() =>
    initialCondition ? cloneFilter(initialCondition) : getDefaultCondition()
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fieldMap = useMemo(
    () => new Map(fields.map((item) => [item.id, item])),
    [fields]
  );
  const field = fieldMap.get(condition.field);
  const valueValid = isValueValid(
    field,
    condition.operator,
    condition.value,
    fieldMap
  );
  const errorId = `simple-filter-${condition.id}-error`;
  const hintId = `simple-filter-${condition.id}-hint`;

  useEffect(() => {
    setCondition(
      initialCondition ? cloneFilter(initialCondition) : getDefaultCondition()
    );
    setError(null);
  }, [initialCondition]);

  const setField = useCallback(
    (fieldId: string) => {
      const nextField = fieldMap.get(fieldId);
      const nextOperator = nextField?.operators[0] ?? "eq";
      setCondition((current) => ({
        ...current,
        field: fieldId,
        operator: nextOperator,
        value: nextField ? defaultFilterValue(nextOperator) : undefined,
      }));
      setError(null);
    },
    [fieldMap]
  );
  const submit = useCallback(
    async (candidate = condition) => {
      const candidateField = fieldMap.get(candidate.field);
      const candidateValid =
        isValueValid(
          candidateField,
          candidate.operator,
          candidate.value,
          fieldMap
        ) &&
        (Boolean(initialCondition) || canAdd);
      if (!candidateValid || saving) {
        return;
      }
      setSaving(true);
      setError(null);
      try {
        await onSubmit(candidate);
        onCancel();
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "Не удалось применить фильтр"
        );
      } finally {
        setSaving(false);
      }
    },
    [canAdd, condition, fieldMap, initialCondition, onCancel, onSubmit, saving]
  );
  const setOperator = useCallback(
    (nextOperator: string) => {
      const operator = nextOperator as FilterOperator;
      const next = {
        ...condition,
        operator,
        value: field ? defaultFilterValue(operator) : undefined,
      };
      setCondition(next);
      setError(null);
      if (EMPTY_VALUE_OPERATORS.has(operator)) {
        return submit(next);
      }
    },
    [condition, field, submit]
  );
  const commitValue = useCallback(
    (value: FilterValue | undefined) => {
      const next = { ...condition, value };
      setCondition(next);
      return submit(next);
    },
    [condition, submit]
  );
  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      return submit();
    },
    [submit]
  );

  return (
    <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
      <div>
        <p className="font-medium text-sm">
          {initialCondition ? "Изменить фильтр" : "Новый фильтр"}
        </p>
        <p className="mt-0.5 text-muted-foreground text-xs">
          Выберите поле, условие и значение.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <FieldPicker
          ariaLabel="Поле фильтра"
          fields={fields}
          id={`simple-filter-${condition.id}-field`}
          onValueChange={setField}
          testId="farm-filter-field"
          value={condition.field}
        />
        <Select
          disabled={!field}
          key={condition.field || "unselected"}
          onValueChange={setOperator}
          value={field ? condition.operator : ""}
        >
          <SelectTrigger
            aria-label="Оператор фильтра"
            className="w-full"
            data-testid="farm-filter-operator"
            size="sm"
          >
            <SelectValue placeholder="Выберите условие">
              {field ? operatorLabels[condition.operator] : null}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {field?.operators.map((item) => (
                <SelectItem key={item} value={item}>
                  {operatorLabels[item]}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <FilterOperandEditor
          condition={condition}
          describedBy={[hintId, error ? errorId : null]
            .filter(Boolean)
            .join(" ")}
          field={field}
          fields={fields}
          idPrefix="simple-filter"
          invalid={!valueValid}
          key={`${condition.field}:${condition.operator}`}
          onChange={(value) =>
            setCondition((current) => ({ ...current, value }))
          }
          onCommit={commitValue}
          viewId={viewId}
        />
      </div>
      <p className="text-muted-foreground text-xs" id={hintId}>
        Готовое значение применяется сразу; текст и диапазон — по Enter или при
        выходе из поля.
      </p>
      {error ? (
        <div
          className="flex items-center gap-2 text-destructive text-xs"
          role="alert"
        >
          <span id={errorId}>{error}</span>
          <Button
            data-testid="farm-filter-retry"
            disabled={saving}
            onClick={() => submit()}
            size="xs"
            type="button"
            variant="outline"
          >
            <RotateCcwIcon data-icon="inline-start" />
            Повторить
          </Button>
        </div>
      ) : null}
      {!initialCondition && !canAdd ? (
        <p className="text-muted-foreground text-xs">
          Достигнут лимит: {MAX_FILTER_CONDITIONS} условий.
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <Button onClick={onCancel} size="sm" type="button" variant="ghost">
          Отмена
        </Button>
        {saving ? (
          <span className="text-muted-foreground text-xs" role="status">
            Применяем…
          </span>
        ) : null}
      </div>
    </form>
  );
}

function NodeActions({
  canMoveDown,
  canMoveUp,
  label,
  onMoveDown,
  onMoveUp,
  onRemove,
}: {
  canMoveDown: boolean;
  canMoveUp: boolean;
  label: string;
  onMoveDown: () => void;
  onMoveUp: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Button
        aria-label={`${label}: выше`}
        disabled={!canMoveUp}
        onClick={onMoveUp}
        size="icon-xs"
        variant="ghost"
      >
        <ArrowUpIcon />
      </Button>
      <Button
        aria-label={`${label}: ниже`}
        disabled={!canMoveDown}
        onClick={onMoveDown}
        size="icon-xs"
        variant="ghost"
      >
        <ArrowDownIcon />
      </Button>
      <Button
        aria-label={`${label}: удалить`}
        onClick={onRemove}
        size="icon-xs"
        variant="ghost"
      >
        <Trash2Icon />
      </Button>
    </div>
  );
}

type ToolbarButtonProps = Omit<
  ComponentProps<typeof Button>,
  "children" | "ref"
> & {
  active: boolean;
  children: ReactNode;
  index: number;
  ref?: Ref<HTMLButtonElement>;
  setActiveIndex: (index: number) => void;
  testId: string;
  toolbarRefs: RefObject<Array<HTMLButtonElement | null>>;
};

function ToolbarButton({
  active,
  children,
  index,
  onFocus,
  onKeyDown,
  ref: forwardedRef,
  setActiveIndex,
  testId,
  toolbarRefs,
  ...buttonProps
}: ToolbarButtonProps) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      onKeyDown?.(event);
      if (event.defaultPrevented) {
        return;
      }
      let next: number | null = null;
      if (event.key === "ArrowRight") {
        next = (index + 1) % 3;
      } else if (event.key === "ArrowLeft") {
        next = (index + 2) % 3;
      } else if (event.key === "Home") {
        next = 0;
      } else if (event.key === "End") {
        next = 2;
      }
      if (next !== null) {
        event.preventDefault();
        setActiveIndex(next);
        toolbarRefs.current?.[next]?.focus();
      }
    },
    [index, onKeyDown, setActiveIndex, toolbarRefs]
  );
  return (
    <Button
      {...buttonProps}
      className="shrink-0"
      data-testid={testId}
      onFocus={(event) => {
        onFocus?.(event);
        setActiveIndex(index);
      }}
      onKeyDown={handleKeyDown}
      ref={(node) => {
        if (toolbarRefs.current) {
          toolbarRefs.current[index] = node;
        }
        if (typeof forwardedRef === "function") {
          forwardedRef(node);
        } else if (forwardedRef) {
          (forwardedRef as { current: HTMLButtonElement | null }).current =
            node;
        }
      }}
      size="sm"
      tabIndex={active ? 0 : -1}
      variant={buttonProps.variant ?? "ghost"}
    >
      {children}
    </Button>
  );
}

type RuleListProps<T extends { id: string }> = {
  addLabel: string;
  availableFields: TableField[];
  emptyLabel: string;
  max: number;
  onAdd: () => void;
  onMove: (id: string, index: number) => void;
  onRemove: (id: string) => void;
  onUpdate: (rule: T) => void;
  renderExtras?: (rule: T) => ReactNode;
  rules: T[];
};

function OrderedRuleList<T extends SortRule | GroupRule>({
  addLabel,
  availableFields,
  emptyLabel,
  max,
  onAdd,
  onMove,
  onRemove,
  onUpdate,
  renderExtras,
  rules,
}: RuleListProps<T>) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const startDrag = useCallback(
    (event: DragEvent<HTMLButtonElement>, ruleId: string) => {
      setDraggingId(ruleId);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", ruleId);
    },
    []
  );
  return (
    <div className="flex flex-col gap-2">
      {rules.length === 0 ? (
        <p className="rounded-lg border border-dashed p-3 text-muted-foreground text-sm">
          {emptyLabel}
        </p>
      ) : null}
      {rules.map((rule, index) => (
        <div
          className={cn(
            "flex items-center gap-2 rounded-lg",
            draggingId === rule.id && "opacity-60"
          )}
          key={rule.id}
        >
          <Button
            aria-label={`Перетащить правило ${index + 1}`}
            draggable
            onDragEnd={() => setDraggingId(null)}
            onDragOver={(event) => {
              if (draggingId) {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }
            }}
            onDragStart={(event) => startDrag(event, rule.id)}
            onDrop={(event) => {
              event.preventDefault();
              const ruleId =
                draggingId || event.dataTransfer.getData("text/plain");
              if (ruleId) {
                onMove(ruleId, index);
              }
              setDraggingId(null);
            }}
            size="icon-xs"
            variant="ghost"
          >
            <GripVerticalIcon />
          </Button>
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-xs">
            {index + 1}
          </span>
          <Select
            onValueChange={(field) => onUpdate({ ...rule, field })}
            value={rule.field}
          >
            <SelectTrigger
              aria-label={`Поле правила ${index + 1}`}
              className="min-w-0 flex-1"
              size="sm"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {availableFields.map((field) => (
                  <SelectItem
                    disabled={rules.some(
                      (item) => item.id !== rule.id && item.field === field.id
                    )}
                    key={field.id}
                    value={field.id}
                  >
                    {field.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select
            onValueChange={(direction) =>
              onUpdate({ ...rule, direction: direction as "asc" | "desc" })
            }
            value={rule.direction}
          >
            <SelectTrigger
              aria-label={`Направление правила ${index + 1}`}
              size="sm"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="asc">По возрастанию</SelectItem>
                <SelectItem value="desc">По убыванию</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          {renderExtras?.(rule)}
          <NodeActions
            canMoveDown={index < rules.length - 1}
            canMoveUp={index > 0}
            label={`Правило ${index + 1}`}
            onMoveDown={() => onMove(rule.id, index + 1)}
            onMoveUp={() => onMove(rule.id, index - 1)}
            onRemove={() => onRemove(rule.id)}
          />
        </div>
      ))}
      <Button
        disabled={rules.length >= max || availableFields.length <= rules.length}
        onClick={onAdd}
        size="sm"
        variant="ghost"
      >
        <PlusIcon data-icon="inline-start" />
        {addLabel}
      </Button>
    </div>
  );
}

function SingleGroupRuleEditor({
  availableFields,
  onAdd,
  onRemove,
  onUpdate,
  rule,
}: {
  availableFields: TableField[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onUpdate: (rule: GroupRule) => void;
  rule?: GroupRule;
}) {
  if (!rule) {
    return (
      <div className="flex flex-col gap-2">
        <p className="rounded-lg border border-dashed p-3 text-muted-foreground text-sm">
          Строки показаны без групп.
        </p>
        <Button
          disabled={availableFields.length === 0}
          onClick={onAdd}
          size="sm"
          variant="ghost"
        >
          <PlusIcon data-icon="inline-start" />
          Добавить группировку
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Select
        onValueChange={(field) => onUpdate({ ...rule, field })}
        value={rule.field}
      >
        <SelectTrigger
          aria-label="Поле группировки"
          className="min-w-0 flex-1"
          size="sm"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {availableFields.map((field) => (
              <SelectItem key={field.id} value={field.id}>
                {field.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Select
        onValueChange={(direction) =>
          onUpdate({ ...rule, direction: direction as "asc" | "desc" })
        }
        value={rule.direction}
      >
        <SelectTrigger aria-label="Порядок групп" size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="asc">По возрастанию</SelectItem>
            <SelectItem value="desc">По убыванию</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      <Button
        aria-pressed={rule.hideEmpty}
        onClick={() => onUpdate({ ...rule, hideEmpty: !rule.hideEmpty })}
        size="sm"
        variant={rule.hideEmpty ? "secondary" : "ghost"}
      >
        Без пустых
      </Button>
      <Button
        aria-label="Удалить группировку"
        onClick={() => onRemove(rule.id)}
        size="icon-sm"
        variant="ghost"
      >
        <Trash2Icon />
      </Button>
    </div>
  );
}

function AppliedFilterChip({
  condition,
  fieldMap,
  onRemove,
  onSubmit,
  viewId,
}: {
  condition: FilterCondition;
  fieldMap: Map<string, TableField>;
  onRemove: () => Promise<void> | void;
  onSubmit: (condition: FilterCondition) => Promise<void> | void;
  viewId: string;
}) {
  const [open, setOpen] = useState(false);
  const label = conditionLabel(condition, fieldMap);

  return (
    <ButtonGroup className="shrink-0">
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger asChild>
          <Button
            className="max-w-64"
            data-testid="farm-filter-chip"
            size="xs"
            title={label}
            variant="outline"
          >
            <span className="truncate">{label}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="bg-background [&_[data-slot=command]]:bg-background w-80">
          <SimpleFilterEditor
            canAdd
            fields={[...fieldMap.values()]}
            initialCondition={condition}
            onCancel={() => setOpen(false)}
            onSubmit={onSubmit}
            viewId={viewId}
          />
        </PopoverContent>
      </Popover>
      <Button
        aria-label={`Удалить фильтр: ${label}`}
        data-testid="farm-filter-chip-remove"
        onClick={onRemove}
        size="icon-xs"
        variant="outline"
      >
        <XIcon />
      </Button>
    </ButtonGroup>
  );
}

function AppliedFilterExpression({
  fieldMap,
  group,
  onRemove,
  onSubmit,
  root = false,
  viewId,
}: {
  fieldMap: Map<string, TableField>;
  group: FilterGroup;
  onRemove: (conditionId: string) => Promise<void> | void;
  onSubmit: (condition: FilterCondition) => Promise<void> | void;
  root?: boolean;
  viewId: string;
}) {
  // Farm scope stays in the query; only its table controls are hidden.
  const children = group.children.filter((node) => node.kind === "condition"
    ? node.field !== "farmId"
    : collectFilterConditions(node).some((condition) => condition.field !== "farmId"));
  if (!children.length) return null;
  const wrapped = !root || group.negated;
  return (
    <>
      {group.negated ? (
        <span className="shrink-0 text-muted-foreground text-xs">НЕ</span>
      ) : null}
      {wrapped ? (
        <span className="shrink-0 text-muted-foreground text-xs">(</span>
      ) : null}
      {children.map((node, index) => (
        <div className="contents" key={node.id}>
          {index > 0 ? (
            <span className="shrink-0 text-muted-foreground text-xs">
              {group.combinator === "and" ? "И" : "ИЛИ"}
            </span>
          ) : null}
          {node.kind === "group" ? (
            <AppliedFilterExpression
              fieldMap={fieldMap}
              group={node}
              onRemove={onRemove}
              onSubmit={onSubmit}
              viewId={viewId}
            />
          ) : (
            <AppliedFilterChip
              condition={node}
              fieldMap={fieldMap}
              onRemove={() => onRemove(node.id)}
              onSubmit={onSubmit}
              viewId={viewId}
            />
          )}
        </div>
      ))}
      {wrapped ? (
        <span className="shrink-0 text-muted-foreground text-xs">)</span>
      ) : null}
    </>
  );
}

export function TableViewControls({
  columns,
  fields: allFields,
  filters,
  groupBy,
  isMutating = false,
  onOperations,
  sort,
  viewId,
}: TableViewControlsProps) {
  const fields = useMemo(() => allFields.filter((field) => field.id !== "farmId"), [allFields]);
  const [activeToolbarIndex, setActiveToolbarIndex] = useState(0);
  const [filterRowOpen, setFilterRowOpen] = useState(false);
  const [addFilterOpen, setAddFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [backgroundError, setBackgroundError] = useState<string | null>(null);
  const lastBackgroundMutationRef = useRef<BackgroundMutation | null>(null);
  const toolbarRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const fieldMap = useMemo(
    () => new Map(fields.map((field) => [field.id, field])),
    [fields]
  );
  const columnFields = useMemo(
    () => fields.filter((field) => field.column),
    [fields]
  );
  const sortableFields = useMemo(
    () => columnFields.filter((field) => field.sortable),
    [columnFields]
  );
  const groupableFields = useMemo(
    () => columnFields.filter((field) => field.groupable),
    [columnFields]
  );
  const filterConditions = useMemo(
    () => collectFilterConditions(filters).filter((condition) => condition.field !== "farmId"),
    [filters]
  );

  const runBackgroundMutation = useCallback(
    async (mutation: BackgroundMutation) => {
      lastBackgroundMutationRef.current = mutation;
      setBackgroundError(null);
      try {
        await onOperations(mutation.operations);
        if (lastBackgroundMutationRef.current === mutation) {
          lastBackgroundMutationRef.current = null;
          setBackgroundError(null);
        }
      } catch (cause) {
        if (lastBackgroundMutationRef.current === mutation) {
          setBackgroundError(
            cause instanceof Error
              ? cause.message
              : "Не удалось изменить таблицу"
          );
        }
      }
    },
    [onOperations]
  );
  const retryBackgroundMutation = useCallback(() => {
    const mutation = lastBackgroundMutationRef.current;
    return mutation ? runBackgroundMutation(mutation) : Promise.resolve();
  }, [runBackgroundMutation]);

  const addFilter = useCallback(
    async (condition: FilterCondition) => {
      if (filterConditions.length >= MAX_FILTER_CONDITIONS) {
        throw new Error(
          `Можно задать не более ${MAX_FILTER_CONDITIONS} условий`
        );
      }
      await onOperations([
        {
          index: filters.children.length,
          node: condition,
          parentId: filters.id,
          type: "filter.add",
        },
      ]);
    },
    [filterConditions.length, filters.children.length, filters.id, onOperations]
  );
  const updateFilter = useCallback(
    (condition: FilterCondition) =>
      onOperations([
        {
          node: condition,
          nodeId: condition.id,
          type: "filter.update",
        },
      ]),
    [onOperations]
  );
  const removeFilter = useCallback(
    (conditionId: string) =>
      runBackgroundMutation({
        kind: "operations",
        operations: [{ nodeId: conditionId, type: "filter.remove" }],
      }),
    [runBackgroundMutation]
  );

  const addSort = useCallback(() => {
    const field = sortableFields.find(
      (candidate) => !sort.some((rule) => rule.field === candidate.id)
    );
    if (field) {
      return runBackgroundMutation({
        kind: "operations",
        operations: [
          {
            index: sort.length,
            rule: { direction: "asc", field: field.id, id: makeId("sort") },
            type: "sort.add",
          },
        ],
      });
    }
  }, [runBackgroundMutation, sort, sortableFields]);
  const addGroup = useCallback(() => {
    if (groupBy.length >= MAX_GROUP_RULES) {
      return;
    }
    const field = groupableFields.find(
      (candidate) => !groupBy.some((rule) => rule.field === candidate.id)
    );
    if (field) {
      return runBackgroundMutation({
        kind: "operations",
        operations: [
          {
            index: 0,
            rule: {
              direction: "asc",
              field: field.id,
              hideEmpty: false,
              id: makeId("group"),
            },
            type: "group.add",
          },
        ],
      });
    }
  }, [groupBy, groupableFields, runBackgroundMutation]);

  return (
    <>
      <div
        className="flex h-[var(--app-bar-height)] shrink-0 items-center gap-1 border-b bg-background px-3"
        data-testid="farm-toolbar"
      >
        <div
          aria-label="Настройка выборки"
          className="flex min-w-0 items-center gap-1"
          role="toolbar"
        >

          <ToolbarButton
            active={activeToolbarIndex === 0}
            aria-expanded={filterRowOpen}
            index={0}
            onClick={() => {
              setFilterRowOpen((open) => {
                if (open) {
                  setAddFilterOpen(false);
                }
                return !open;
              });
            }}
            setActiveIndex={setActiveToolbarIndex}
            testId="farm-filtering"
            toolbarRefs={toolbarRefs}
            variant="ghost"
          >
            <FilterIcon data-icon="inline-start" />
            Фильтр
            {filterConditions.length > 0 ? (
              <Badge
                variant="secondary"
                style={{ backgroundColor: "var(--neutral-50)" }}
              >
                {filterConditions.length}
              </Badge>
            ) : null}
          </ToolbarButton>

          <Popover onOpenChange={setSortOpen} open={sortOpen}>
            <PopoverTrigger asChild>
              <ToolbarButton
                active={activeToolbarIndex === 1}
                index={1}
                setActiveIndex={setActiveToolbarIndex}
                testId="farm-sorting"
                toolbarRefs={toolbarRefs}
              >
                <ArrowDownNarrowWideIcon data-icon="inline-start" />
                Сортировка
                {sort.length > 0 ? (
                  <Badge variant="secondary">{sort.length}</Badge>
                ) : null}
              </ToolbarButton>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="bg-background [&_[data-slot=command]]:bg-background w-[38rem] max-w-[calc(100vw-2rem)]"
              id="farm-sort-popover"
            >
              <div className="mb-3">
                <p className="font-medium text-sm">Сортировка</p>
                <p className="mt-0.5 text-muted-foreground text-xs">
                  Верхнее правило применяется первым.
                </p>
              </div>
              <OrderedRuleList
                addLabel="Добавить сортировку"
                availableFields={sortableFields}
                emptyLabel="Порядок строк пока не задан."
                max={5}
                onAdd={addSort}
                onMove={(ruleId, index) =>
                  runBackgroundMutation({
                    kind: "operations",
                    operations: [{ index, ruleId, type: "sort.move" }],
                  })
                }
                onRemove={(ruleId) =>
                  runBackgroundMutation({
                    kind: "operations",
                    operations: [{ ruleId, type: "sort.remove" }],
                  })
                }
                onUpdate={(rule) =>
                  runBackgroundMutation({
                    kind: "operations",
                    operations: [
                      { rule, ruleId: rule.id, type: "sort.update" },
                    ],
                  })
                }
                rules={sort}
              />
            </PopoverContent>
          </Popover>

          <Popover onOpenChange={setGroupOpen} open={groupOpen}>
            <PopoverTrigger asChild>
              <ToolbarButton
                active={activeToolbarIndex === 2}
                index={2}
                setActiveIndex={setActiveToolbarIndex}
                testId="farm-grouping"
                toolbarRefs={toolbarRefs}
              >
                <ListTreeIcon data-icon="inline-start" />
                Группировка
                {groupBy.length > 0 ? (
                  <Badge variant="secondary">{groupBy.length}</Badge>
                ) : null}
              </ToolbarButton>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="bg-background [&_[data-slot=command]]:bg-background w-[42rem] max-w-[calc(100vw-2rem)]"
              id="farm-group-popover"
            >
              <div className="mb-3">
                <p className="font-medium text-sm">Группировка</p>
                <p className="mt-0.5 text-muted-foreground text-xs">
                  Выберите один атрибут для разделения списка.
                </p>
              </div>
              <SingleGroupRuleEditor
                availableFields={groupableFields}
                onAdd={addGroup}
                onRemove={(ruleId) =>
                  runBackgroundMutation({
                    kind: "operations",
                    operations: [{ ruleId, type: "group.remove" }],
                  })
                }
                onUpdate={(rule) =>
                  runBackgroundMutation({
                    kind: "operations",
                    operations: [
                      { rule, ruleId: rule.id, type: "group.update" },
                    ],
                  })
                }
                rule={groupBy[0]}
              />
            </PopoverContent>
          </Popover>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="sm"><Columns3Icon data-icon="inline-start" />Колонки</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="bg-background [&_[data-slot=command]]:bg-background max-h-80 overflow-y-auto">
              <DropdownMenuGroup>
                {columnFields.map(field => <DropdownMenuCheckboxItem key={field.id}
                  checked={columns.includes(field.id)}
                  disabled={isMutating || field.id === "primaryIdentifier"}
                  onSelect={event => event.preventDefault()}
                  onCheckedChange={checked => runBackgroundMutation({ kind: "operations", operations: [{ type: "view.update", patch: { columns: checked ? [...columns, field.id] : columns.filter(id => id !== field.id) } }] })}
                >{field.label}</DropdownMenuCheckboxItem>)}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {filterRowOpen ? (
        <div
          className="flex h-[var(--app-bar-height)] shrink-0 items-center gap-2 border-b bg-background px-3"
          data-testid="farm-applied-rules"
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
          <AppliedFilterExpression
            fieldMap={fieldMap}
            group={filters}
            onRemove={removeFilter}
            onSubmit={updateFilter}
            root
            viewId={viewId}
          />
          <Popover onOpenChange={setAddFilterOpen} open={addFilterOpen}>
            <PopoverTrigger asChild>
              <Button
                data-testid="farm-add-filter"
                disabled={filterConditions.length >= MAX_FILTER_CONDITIONS}
                size="xs"
                variant="ghost"
              >
                <PlusIcon data-icon="inline-start" />
                Добавить фильтр
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="bg-background [&_[data-slot=command]]:bg-background w-80">
              <SimpleFilterEditor
                canAdd={filterConditions.length < MAX_FILTER_CONDITIONS}
                fields={fields}
                key={addFilterOpen ? "new-open" : "new-closed"}
                onCancel={() => setAddFilterOpen(false)}
                onSubmit={addFilter}
                viewId={viewId}
              />
            </PopoverContent>
          </Popover>
          </div>
          <Button
            className="shrink-0"
            size="xs"
            variant="ghost"
            aria-label="Сбросить все фильтры"
            title="Сбросить все фильтры"
            disabled={isMutating || filterConditions.length === 0}
            onClick={() => {
              setAddFilterOpen(false);
              void runBackgroundMutation({
                kind: "operations",
                operations: filterConditions.map(condition => ({
                  type: "filter.remove" as const,
                  nodeId: condition.id,
                })),
              });
            }}
          >
            <RotateCcwIcon data-icon="inline-start" />
            Сбросить
          </Button>
        </div>
      ) : null}

      {backgroundError ? (
        <div
          className="flex min-h-11 items-center gap-3 border-b bg-destructive/5 px-3 py-2 text-destructive text-xs"
          role="alert"
        >
          <span className="min-w-0 flex-1">{backgroundError}</span>
          <Button
            disabled={isMutating}
            onClick={retryBackgroundMutation}
            size="xs"
            variant="outline"
          >
            <RotateCcwIcon data-icon="inline-start" />
            Повторить
          </Button>
        </div>
      ) : null}
    </>
  );
}
