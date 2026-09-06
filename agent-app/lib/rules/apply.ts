import "server-only";

import { queryAnimals } from "../farm/queries";
import { getAuthorizedFieldRegistry } from "../farm/registry";
import type { FilterScalar } from "../farm/types";
import {
  applyRuleView,
  getSavedView,
  ViewRevisionConflictError,
} from "../farm/views";
import { compileListRule } from "./compiler";
import { farmMayMatch } from "./farm-scope";
import { getRuleBinding } from "./store";

export async function applyListRule(input: {
  userId: string;
  viewId: string;
  expectedRevision: number;
  ruleId: string;
  ruleVersion: string;
  bindingId: string;
  bindingVersion: string;
  parameters: Record<string, FilterScalar>;
}) {
  const current = await getSavedView({
    id: input.viewId,
    userId: input.userId,
  });
  if (!current) {
    return { error: "VIEW_NOT_FOUND" } as const;
  }
  if (current.revision !== input.expectedRevision) {
    throw new ViewRevisionConflictError(current);
  }
  const selected = await getRuleBinding({
    bindingId: input.bindingId,
    ruleId: input.ruleId,
    userId: input.userId,
    version: input.bindingVersion,
  });
  if (!selected) {
    return { error: "RULE_NOT_FOUND" } as const;
  }
  if (selected.ruleVersion !== input.ruleVersion) {
    return { error: "RULE_VERSION_MISMATCH" } as const;
  }
  if (!farmMayMatch(current.filters, selected.binding.farmId)[0]) {
    return { error: "RULE_FARM_SCOPE_CONFLICT" } as const;
  }
  const registry = await getAuthorizedFieldRegistry(input.userId);
  const compiled = compileListRule(
    selected.rule,
    {
      ...selected.binding.config,
      parameters: {
        ...selected.binding.config.parameters,
        ...input.parameters,
      },
    },
    registry
  );
  const parameterIds = new Set(
    compiled.parameters.map((parameter) => parameter.id)
  );
  const unknownParameters = Object.keys(input.parameters).filter(
    (key) => !parameterIds.has(key)
  );
  if (unknownParameters.length) {
    return {
      error: "RULE_PARAMETER_UNKNOWN",
      parameters: unknownParameters,
    } as const;
  }
  if (!compiled.patch) {
    return {
      diagnostics: compiled.diagnostics,
      error: "RULE_NOT_EXECUTABLE",
      parameters: compiled.parameters,
    } as const;
  }
  const asOf = new Date().toISOString();
  const { patch } = compiled;
  // No mutation until the full typed rule has successfully executed against facts.
  const preview = await queryAnimals({
    asOf,
    columns: patch.columns ?? current.columns,
    fieldRegistry: registry,
    filters: patch.filters ?? current.filters,
    groupBy: patch.groupBy ?? current.groupBy,
    limit: 1,
    sort: patch.sort ?? current.sort,
    userId: input.userId,
    viewId: current.id,
  });
  const view = await applyRuleView({
    context: {
      asOf,
      bindingId: selected.binding.id,
      bindingVersion: selected.binding.version,
      modified: false,
      parameters: {
        ...selected.binding.config.parameters,
        ...input.parameters,
      },
      ruleId: selected.ruleId,
      ruleVersion: selected.ruleVersion,
      snapshot: preview.snapshot,
    },
    expectedRevision: input.expectedRevision,
    id: current.id,
    patch,
    userId: input.userId,
  });
  return {
    asOf,
    snapshot: preview.snapshot,
    totalRows: preview.totalRows,
    view,
  };
}
