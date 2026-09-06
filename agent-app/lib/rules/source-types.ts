import type { FilterScalar } from "../farm/types";

/** Parser offsets are Unicode code points, not JavaScript UTF-16 offsets. */
export type SourceSpan = { column: string; start: number; end: number };
export type RuleDiagnostic = {
  code: string;
  severity: "syntax" | "semantic";
  span: SourceSpan;
  raw: string;
  message: string;
};
export type SourceOperand = {
  kind: "decimal" | "date" | "relativeDate" | "none" | "unresolved";
  raw: string;
  value?: string;
  anchor?: "as_of_local_date";
  offsetDays?: number;
  span?: SourceSpan;
  candidates?: string[];
  reason?: string;
};
export type SourceNode =
  | {
      kind: "group";
      operator: "AND" | "OR" | "NOT";
      name: string | null;
      children: SourceNode[];
      span: SourceSpan;
    }
  | {
      kind: "predicate";
      fieldLabel: string;
      fieldSpan: SourceSpan;
      operator: string;
      operand: SourceOperand;
      span: SourceSpan;
    }
  | { kind: "unknown"; raw: string; span: SourceSpan };
export type NormalizedRule = {
  parserVersion: string;
  source: {
    snapshotSha256: string;
    definitionId: string;
    rowNumber: number;
    companyId: string;
    listId: string;
  };
  raw: Record<string, string>;
  selection: { roots: SourceNode[]; rootCombination: "SINGLE" | null };
  columns: { label: string; span: SourceSpan; lexicalStatus?: "candidate" }[];
  groupBy: { label: string; span: SourceSpan }[];
  vitality: { raw: string; value: "alive" | "dead" | "all" | null };
  diagnostics: RuleDiagnostic[];
  status: { parsed: boolean; semanticResolved: boolean };
};
export type RuleParameter = {
  id: string;
  label: string;
  type: FilterScalar["type"];
  required: boolean;
  values?: FilterScalar[];
};
export type RuleBinding = {
  farmId: string;
  sourceCompanyId: string;
  version: string;
  rootPolicy: "explicit_only" | "flat_and";
  vitalityPolicy: "unresolved" | "life_state";
  parameters: Record<string, FilterScalar>;
  fieldBindings?: Record<string, string>;
  valueBindings?: Record<string, Record<string, FilterScalar>>;
  operandBindings?: Record<
    string,
    | {
        kind: "parameter";
        id: string;
        type: FilterScalar["type"];
        values?: FilterScalar[];
      }
    | { kind: "field"; field: string }
    | { kind: "literal"; value: FilterScalar }
  >;
  nullPolicy?: "unresolved" | "sql_null";
  emptySelectionPolicy?: "unresolved" | "no_predicate";
  emptyColumnsPolicy?: "unresolved" | "mandatory_identity_if_source_empty";
};
