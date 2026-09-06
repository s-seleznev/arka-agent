import { createHash } from "node:crypto";
import { type FieldRegistry, farmFields } from "../farm/fields";
import {
  type FilterGroup,
  type FilterNode,
  type FilterOperator,
  type FilterScalar,
  type FilterValue,
  filterScalarSchema,
  REPORT_VIEW_SCHEMA_VERSION,
  type ReportViewPatch,
  reportViewPatchSchema,
} from "../farm/types";
import {
  ViewValidationError,
  validateReportViewState,
} from "../farm/view-model";
import { mapSourceField, mapSourceLiteral } from "./mapping";
import type {
  NormalizedRule,
  RuleBinding,
  RuleDiagnostic,
  RuleParameter,
  SourceNode,
  SourceSpan,
} from "./source-types";

const operators: Record<string, FilterOperator> = {
  "!=": "neq",
  "<": "lt",
  "<=": "lte",
  "=": "eq",
  ">": "gt",
  ">=": "gte",
  IS_NULL: "is_empty",
  NOT_NULL: "is_not_empty",
  пусто: "is_empty",
  "≠": "neq",
  "≤": "lte",
  "≥": "gte",
};

function stableId(key: string) {
  const hex = createHash("sha256").update(key).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function compileListRule(
  record: NormalizedRule,
  binding: RuleBinding,
  registry: FieldRegistry = farmFields
): {
  patch?: ReportViewPatch;
  diagnostics: RuleDiagnostic[];
  parameters: RuleParameter[];
} {
  const diagnostics: RuleDiagnostic[] = [];
  const parameters: RuleParameter[] = [];
  const { roots } = record.selection;
  const fallbackSpan = {
    column: "filters_text",
    end: Array.from(record.raw.filters_text ?? "").length,
    start: 0,
  };
  const id = (path: string) =>
    stableId(
      `${record.source.definitionId}:${binding.version}:${binding.farmId}:${path}`
    );
  const issue = (
    code: string,
    message: string,
    at: SourceSpan = fallbackSpan
  ) => {
    diagnostics.push({
      code,
      message,
      raw: Array.from(record.raw[at.column] ?? "")
        .slice(at.start, at.end)
        .join(""),
      severity: "semantic",
      span: at,
    });
  };
  const flatAnd =
    binding.rootPolicy === "flat_and" &&
    roots.every((node) => node.kind === "predicate");
  for (const diagnostic of record.diagnostics) {
    const accepted =
      diagnostic.severity !== "syntax" &&
      (diagnostic.code === "OPERAND_KIND_UNCONFIRMED" ||
        (diagnostic.code === "ROOT_COMBINATION_UNCONFIRMED" && flatAnd) ||
        (diagnostic.code === "NAMED_BLOCK_MEMBERSHIP_UNCONFIRMED" &&
          roots.length === 1 &&
          roots[0].kind === "group" &&
          roots[0].name !== null &&
          diagnostic.span.start === roots[0].span.start) ||
        (diagnostic.code === "NULL_POLICY_UNCONFIRMED" &&
          binding.nullPolicy === "sql_null") ||
        (diagnostic.code === "EMPTY_SELECTION_UNCONFIRMED" &&
          binding.emptySelectionPolicy === "no_predicate") ||
        (diagnostic.code === "VITALITY_BINDING_UNCONFIRMED" &&
          binding.vitalityPolicy === "life_state"));
    if (!accepted) {
      diagnostics.push(diagnostic);
    }
  }
  if (binding.sourceCompanyId !== record.source.companyId) {
    issue(
      "BINDING_COMPANY_MISMATCH",
      "Binding company does not match the immutable source company."
    );
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      binding.farmId
    )
  ) {
    issue("INVALID_BINDING_FARM", "Binding farm must be a UUID.");
  }
  if (
    !record.status.parsed &&
    !diagnostics.some((d) => d.severity === "syntax")
  ) {
    issue(
      "SOURCE_NOT_PARSED",
      "Source record has not passed parser validation."
    );
  }
  if (roots.length > 1 && !flatAnd) {
    issue(
      "ROOT_COMBINATION_UNCONFIRMED",
      "Multiple roots require confirmed source combination semantics."
    );
  }
  if (!roots.length && binding.emptySelectionPolicy !== "no_predicate") {
    issue(
      "EMPTY_SELECTION_UNCONFIRMED",
      "Binding has no explicit empty-selection policy."
    );
  }
  if (binding.vitalityPolicy !== "life_state") {
    issue("VITALITY_BINDING_UNCONFIRMED", "Binding has no life-state policy.");
  }

  function scalarValue(
    value: FilterScalar,
    type: string,
    at: SourceSpan
  ): FilterScalar | undefined {
    const parsed = filterScalarSchema.safeParse(value);
    const compatible =
      type === "text"
        ? value.type === "string"
        : type === "number"
          ? value.type === "number" || value.type === "decimal"
          : value.type === type;
    if (!parsed.success || !compatible) {
      issue(
        "OPERAND_TYPE_MISMATCH",
        `Operand does not match field type ${type}.`,
        at
      );
      return;
    }
    return parsed.data;
  }

  function compileNode(node: SourceNode, path: string): FilterNode | undefined {
    if (node.kind === "unknown") {
      issue(
        "UNRECOGNIZED_LINE",
        "Unknown source fragment cannot be compiled.",
        node.span
      );
      return;
    }
    if (node.kind === "group") {
      if (
        node.children.length === 0 ||
        (node.operator === "NOT" && node.children.length !== 1)
      ) {
        issue("GROUP_ARITY", "Invalid source group arity.", node.span);
      }
      const children = node.children
        .map((child, i) => compileNode(child, `${path}.${i}`))
        .filter((n): n is FilterNode => n !== undefined);
      return {
        children,
        combinator: node.operator === "OR" ? "or" : "and",
        id: id(path),
        kind: "group",
        negated: node.operator === "NOT",
      };
    }
    const field = mapSourceField(node.fieldLabel, binding, registry);
    if (!field) {
      issue(
        "FIELD_UNMAPPED",
        `No verified field mapping: ${node.fieldLabel}`,
        node.fieldSpan
      );
      return;
    }
    const operator = operators[node.operator];
    if (!operator || !field.operators.includes(operator)) {
      issue(
        "OPERATOR_UNSUPPORTED",
        `Operator ${node.operator} is unavailable for ${field.id}.`,
        node.span
      );
      return;
    }
    let value: FilterValue | undefined;
    const at = node.operand.span ?? node.span;
    const mappedLiteral = mapSourceLiteral(field.id, node.operand.raw, binding);
    if (operator === "is_empty" || operator === "is_not_empty") {
      if (binding.nullPolicy !== "sql_null") {
        issue(
          "NULL_POLICY_UNCONFIRMED",
          "A null comparison requires an explicit binding policy.",
          node.span
        );
      }
      if (node.operand.raw !== "") {
        issue(
          "UNEXPECTED_NULL_OPERAND",
          "Null comparison contains a trailing operand.",
          node.span
        );
      }
    } else if (mappedLiteral) {
      value = scalarValue(mappedLiteral, field.type, at);
    } else if (node.operand.kind === "decimal") {
      value = scalarValue(
        { type: "decimal", value: node.operand.value ?? node.operand.raw },
        field.type,
        at
      );
    } else if (node.operand.kind === "date") {
      value = scalarValue(
        { type: "date", value: node.operand.value ?? node.operand.raw },
        field.type,
        at
      );
    } else if (node.operand.kind === "relativeDate") {
      if (
        field.type !== "date" ||
        typeof node.operand.offsetDays !== "number" ||
        !Number.isSafeInteger(node.operand.offsetDays)
      ) {
        issue(
          "OPERAND_TYPE_MISMATCH",
          "Relative day operand requires a date field and integer offset.",
          at
        );
      } else {
        value = { offset: node.operand.offsetDays, type: "relative_day" };
      }
    } else {
      const mapped = binding.operandBindings?.[node.operand.raw];
      if (mapped?.kind === "parameter") {
        const parameter = {
          id: mapped.id,
          label: node.operand.raw,
          required: true,
          type: mapped.type,
          ...(mapped.values ? { values: mapped.values } : {}),
        };
        const existing = parameters.find((p) => p.id === parameter.id);
        if (
          existing &&
          (existing.type !== parameter.type ||
            JSON.stringify(existing.values) !==
              JSON.stringify(parameter.values))
        ) {
          issue(
            "PARAMETER_DEFINITION_CONFLICT",
            "Parameter has inconsistent declarations.",
            at
          );
        }
        if (!existing) {
          parameters.push(parameter);
        }
        const supplied = binding.parameters[mapped.id];
        if (!supplied) {
          issue("PARAMETER_REQUIRED", `Required parameter: ${mapped.id}`, at);
        } else if (
          supplied.type !== mapped.type ||
          (mapped.values &&
            !mapped.values.some(
              (v) => JSON.stringify(v) === JSON.stringify(supplied)
            ))
        ) {
          issue(
            "PARAMETER_VALUE_INVALID",
            `Invalid parameter: ${mapped.id}`,
            at
          );
        } else {
          value = scalarValue(supplied, field.type, at);
        }
      } else if (mapped?.kind === "field") {
        const other = Object.hasOwn(registry, mapped.field)
          ? registry[mapped.field]
          : undefined;
        if (
          !other ||
          (other.farmIds && !other.farmIds.includes(binding.farmId)) ||
          other.type !== field.type ||
          other.unit !== field.unit
        ) {
          issue(
            "FIELD_REFERENCE_TYPE_MISMATCH",
            "Referenced field must have the same type and unit.",
            at
          );
        } else if (field.type === "number" && (!field.unit || !other.unit)) {
          issue(
            "FIELD_REFERENCE_UNIT_UNCONFIRMED",
            "Numeric field comparison requires explicit unit metadata on both fields.",
            at
          );
        } else {
          value = { field: other.id, type: "field" };
        }
      } else {
        const literal =
          mapped?.kind === "literal"
            ? mapped.value
            : mapSourceLiteral(field.id, node.operand.raw, binding);
        if (literal) {
          value = scalarValue(literal, field.type, at);
        } else {
          issue(
            "OPERAND_KIND_UNCONFIRMED",
            `Unresolved operand: ${node.operand.raw}`,
            at
          );
        }
      }
    }
    return {
      field: field.id,
      id: id(path),
      kind: "condition",
      negated: false,
      operator,
      ...(value ? { value } : {}),
    };
  }

  const sourceNodes = roots
    .map((node, index) => compileNode(node, `root.${index}`))
    .filter((n): n is FilterNode => n !== undefined);
  const columns: string[] = [];
  for (const source of record.columns) {
    const field = mapSourceField(source.label, binding, registry);
    if (!field?.column || source.lexicalStatus === "candidate") {
      issue(
        "COLUMN_UNMAPPED",
        `Unresolved column: ${source.label}`,
        source.span
      );
    } else {
      columns.push(field.id);
    }
  }
  if (
    binding.emptyColumnsPolicy === "mandatory_identity_if_source_empty" &&
    record.columns.length === 0 &&
    record.raw.column_names?.trim() === "" &&
    record.raw.columns_count?.trim() === "0"
  ) {
    // Mandatory row identity is a declared UI adapter, never a source field.
    columns.push("primaryIdentifier");
  }
  if (columns.length === 0) {
    issue("COLUMNS_EMPTY", "Rule has no resolved columns.");
  }
  if (new Set(columns).size !== columns.length) {
    issue(
      "DUPLICATE_COLUMN_MAPPING",
      "Multiple source columns resolve to one field; display semantics require confirmation."
    );
  }
  const groupFields: string[] = [];
  for (const source of record.groupBy) {
    const field = mapSourceField(source.label, binding, registry);
    if (field?.groupable) {
      groupFields.push(field.id);
    } else {
      issue(
        "GROUP_FIELD_UNMAPPED",
        `Unresolved grouping: ${source.label}`,
        source.span
      );
    }
  }
  if (record.groupBy.length > 1) {
    issue(
      "MULTIPLE_GROUP_DIMENSIONS",
      "Current table supports one group dimension; source dimensions cannot be dropped."
    );
  }
  const farm: FilterNode = {
    field: "farmId",
    id: id("farm"),
    kind: "condition",
    negated: false,
    operator: "eq",
    value: { type: "string", value: binding.farmId },
  };
  const children: FilterNode[] = [farm];
  if (record.vitality.value === "alive" || record.vitality.value === "dead") {
    if (!Object.hasOwn(registry, "lifeState")) {
      issue("VITALITY_FIELD_UNAVAILABLE", "Registry has no lifeState field.");
    }
    children.push({
      field: "lifeState",
      id: id("vitality"),
      kind: "condition",
      negated: false,
      operator: "eq",
      value: {
        type: "string",
        value: record.vitality.value === "alive" ? "ACTIVE" : "DEAD",
      },
    });
  } else if (record.vitality.value !== "all") {
    issue("UNKNOWN_VITALITY", "Unknown source vitality value.");
  }
  children.push(...sourceNodes);
  const filters: FilterGroup = {
    children,
    combinator: "and",
    id: id("scope"),
    kind: "group",
    negated: false,
  };
  const patch: ReportViewPatch = {
    columns,
    filters,
    groupBy:
      groupFields.length === 1
        ? [
            {
              direction: "asc",
              field: groupFields[0],
              hideEmpty: false,
              id: id("group"),
            },
          ]
        : [],
  };
  const parsedPatch = reportViewPatchSchema.safeParse(patch);
  if (!parsedPatch.success) {
    issue("VIEW_SCHEMA_REJECTED", parsedPatch.error.message);
  }
  if (parsedPatch.success && diagnostics.length === 0) {
    try {
      validateReportViewState(
        {
          ...parsedPatch.data,
          chatId: id("validation-chat"),
          entityType: "animal",
          id: id("validation-view"),
          revision: 0,
          schemaVersion: REPORT_VIEW_SCHEMA_VERSION,
          sort: [],
        },
        registry
      );
    } catch (error) {
      issue(
        error instanceof ViewValidationError
          ? error.code
          : "VIEW_SEMANTIC_VALIDATION_FAILED",
        error instanceof ViewValidationError
          ? `${error.code}: ${error.path}`
          : "Shared view validation rejected the compiled definition."
      );
    }
  }
  const unique = diagnostics.filter(
    (d, index, all) =>
      all.findIndex(
        (other) =>
          other.code === d.code &&
          other.span.column === d.span.column &&
          other.span.start === d.span.start &&
          other.span.end === d.span.end
      ) === index
  );
  return {
    ...(unique.length === 0 && parsedPatch.success
      ? { patch: parsedPatch.data }
      : {}),
    diagnostics: unique,
    parameters,
  };
}
