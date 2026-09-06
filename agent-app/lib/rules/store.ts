import type { FieldRegistry } from "../farm/fields";
import { getAuthorizedFieldRegistry } from "../farm/registry";
import "server-only";

import { z } from "zod";
import { productClient } from "../db/client";
import { getAccessibleFarms } from "../farm/queries";
import { currentBindings } from "./binding-version";
import { compileListRule } from "./compiler";
import { prepareRuleSearch } from "./search";

export { prepareRuleSearch } from "./search";

import type {
  NormalizedRule,
  RuleBinding,
  RuleDiagnostic,
  RuleParameter,
} from "./source-types";

export type StoredRule = NormalizedRule & {
  id: string;
  version: string;
  name: string;
  description: string;
};
export type StoredBinding = {
  id: string;
  ruleId: string;
  farmId: string;
  version: string;
  config: RuleBinding;
  provenance: string;
  diagnostics: RuleDiagnostic[];
  parameters: RuleParameter[];
  compileReady: boolean;
  queryVerified: false;
};
export type RuleDetails = {
  rule: StoredRule;
  bindings: StoredBinding[];
  parameters: RuleParameter[];
};
export type RuleCandidate = {
  ruleId: string;
  version: string;
  sourceCompanyId: string;
  sourceListId: string;
  name: string;
  description: string;
  farmIds: string[];
  compileReady: boolean;
  queryVerified: false;
  diagnosticCodes: string[];
};
type JoinedRow = {
  id: string;
  version: string;
  name: string;
  description: string;
  normalized: NormalizedRule;
  bindingId: string;
  farmId: string;
  bindingVersion: string;
  config: RuleBinding;
  provenance: string;
};
const scopedInput = z.object({
  farmIds: z.array(z.uuid()).max(100).optional(),
  userId: z.string().min(1),
});
const lookupInput = scopedInput.extend({
  includeHistoricalBindings: z.boolean().optional(),
  ruleId: z.uuid(),
  version: z.string().min(1).max(200).optional(),
});

function activeSourceCompanyId() {
  return process.env.FARM_SKILL_PROFILE_ID === "lactis-prime-8" ? "8" : null;
}

async function scope(userId: string, requested?: string[]) {
  const accessible = await getAccessibleFarms(userId);
  const requestedIds = requested ? new Set(requested) : undefined;
  return accessible
    .filter((farm) => !requestedIds || requestedIds.has(farm.id))
    .map((farm) => farm.id);
}

function bindingFrom(row: JoinedRow, registry: FieldRegistry): StoredBinding {
  if (
    row.config.farmId !== row.farmId ||
    row.config.sourceCompanyId !== row.normalized.source.companyId ||
    row.config.version !== row.bindingVersion
  ) {
    throw new Error("RULE_BINDING_INTEGRITY_FAILURE");
  }
  const compiled = compileListRule(row.normalized, row.config, registry);
  return {
    compileReady: Boolean(compiled.patch),
    config: row.config,
    diagnostics: compiled.diagnostics,
    farmId: row.farmId,
    id: row.bindingId,
    parameters: compiled.parameters,
    provenance: row.provenance,
    queryVerified: false,
    ruleId: row.id,
    version: row.bindingVersion,
  };
}
function ruleFrom(row: JoinedRow): StoredRule {
  return {
    ...row.normalized,
    description: row.description,
    id: row.id,
    name: row.name,
    version: row.version,
  };
}

export async function getListRule(input: {
  includeHistoricalBindings?: boolean;
  userId: string;
  ruleId: string;
  version?: string;
  farmIds?: string[];
}): Promise<RuleDetails | null> {
  const args = lookupInput.parse(input);
  const allowed = await scope(args.userId, args.farmIds);
  if (!allowed.length) {
    return null;
  }
  const registry = await getAuthorizedFieldRegistry(args.userId);
  const rows = await productClient<JoinedRow[]>`
    SELECT d.id,d.version,d.name,d.description,d.normalized,
      b.id AS "bindingId",b."farmId",b.version AS "bindingVersion",b.config,b.provenance
    FROM "RuleDefinition" d JOIN "RuleBinding" b ON b."ruleId"=d.id
    WHERE (${activeSourceCompanyId()}::text IS NULL OR d."sourceCompanyId"=${activeSourceCompanyId()}) AND d.id=${args.ruleId} AND b.enabled AND b."farmId"=ANY(${allowed}::uuid[])
      ${args.version ? productClient`AND d.version=${args.version}` : productClient``}
    ORDER BY b."farmId",b.version,b.id`;
  // Product and farm facts are separate databases: recheck grants before disclosure.
  const stillAllowed = new Set(await scope(args.userId, args.farmIds));
  const visible = rows.filter((row) => stillAllowed.has(row.farmId));
  if (!visible.length) {
    return null;
  }
  const allBindings = visible.map((row) => bindingFrom(row, registry));
  const bindings = args.includeHistoricalBindings
    ? allBindings
    : currentBindings(allBindings);
  const parameters = Array.from(
    new Map(
      bindings
        .flatMap((binding) => binding.parameters)
        .map((parameter) => [JSON.stringify(parameter), parameter])
    ).values()
  );
  return { bindings, parameters, rule: ruleFrom(visible[0]) };
}

export async function getRuleBinding(input: {
  userId: string;
  ruleId: string;
  bindingId?: string;
  farmId?: string;
  version?: string;
}): Promise<{
  rule: NormalizedRule;
  ruleId: string;
  ruleVersion: string;
  binding: StoredBinding;
} | null> {
  const args = z
    .object({
      bindingId: z.uuid().optional(),
      farmId: z.uuid().optional(),
      ruleId: z.uuid(),
      userId: z.string().min(1),
      version: z.string().min(1).max(200).optional(),
    })
    .parse(input);
  const details = await getListRule({
    farmIds: args.farmId ? [args.farmId] : undefined,
    includeHistoricalBindings: Boolean(args.bindingId || args.version),
    ruleId: args.ruleId,
    userId: args.userId,
  });
  if (!details) {
    return null;
  }
  const candidates = details.bindings.filter(
    (binding) =>
      (!args.bindingId || binding.id === args.bindingId) &&
      (!args.version || binding.version === args.version)
  );
  if (!candidates.length) {
    return null;
  }
  if (candidates.length !== 1) {
    throw new Error("RULE_BINDING_AMBIGUOUS");
  }
  return {
    binding: candidates[0],
    rule: details.rule,
    ruleId: details.rule.id,
    ruleVersion: details.rule.version,
  };
}

export async function searchListRules(input: {
  userId: string;
  query: string;
  farmIds?: string[];
  limit?: number;
}): Promise<RuleCandidate[]> {
  const args = scopedInput
    .extend({
      limit: z.number().int().min(1).max(50).default(20),
      query: z.string().trim().min(1).max(500),
    })
    .parse(input);
  const allowed = await scope(args.userId, args.farmIds);
  if (!allowed.length) {
    return [];
  }
  const registry = await getAuthorizedFieldRegistry(args.userId);
  const search = prepareRuleSearch(args.query);
  const text = search.phrase;
  const compound = /^(\d+)[:/](\d+)$/.exec(text);
  const identifierOnly = Boolean(compound) || /^\d+$/.test(text);
  // tsquery contains only Unicode letters/digits and generated | separators.
  // All user text remains parameters; accessible bindings gate the entire ranking.
  const ids = await productClient<{ id: string }[]>`
    WITH latest AS (
      SELECT DISTINCT ON (d."sourceCompanyId",d."sourceListId")
        d.id,d.name,d.description,d."sourceCompanyId",d."sourceListId"
      FROM "RuleDefinition" d JOIN "RuleSourceSnapshot" s ON s.id=d."snapshotId"
      WHERE (${activeSourceCompanyId()}::text IS NULL OR d."sourceCompanyId"=${activeSourceCompanyId()})
      ORDER BY d."sourceCompanyId",d."sourceListId",s."importedAt" DESC,s.id DESC,d.id
    ), candidates AS (
      SELECT d.id,d.name,d."sourceCompanyId",d."sourceListId",
        translate(lower(btrim(regexp_replace(d.name,'\\s+',' ','g'))),'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯё','абвгдеежзийклмнопрстуфхцчшщъыьэюяе') AS title,
        translate(lower(d.description),'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯё','абвгдеежзийклмнопрстуфхцчшщъыьэюяе') AS description,
        setweight(to_tsvector('russian',d.name),'A') || setweight(to_tsvector('russian',d.description),'B') AS document
      FROM latest d
      WHERE EXISTS (SELECT 1 FROM "RuleBinding" b WHERE b."ruleId"=d.id AND b.enabled AND b."farmId"=ANY(${allowed}::uuid[]))
    ), query AS (
      SELECT CASE WHEN ${search.tsquery}='' THEN NULL::tsquery ELSE to_tsquery('russian',${search.tsquery}) END AS primary_query,
        CASE WHEN ${search.fullTsquery}='' THEN NULL::tsquery ELSE to_tsquery('russian',${search.fullTsquery}) END AS full_query
    )
    SELECT d.id FROM candidates d CROSS JOIN query q
    WHERE d."sourceListId"=${text}
      OR (d."sourceCompanyId"=${compound?.[1] ?? ""} AND d."sourceListId"=${compound?.[2] ?? ""})
      OR d.title=${text}
      OR (NOT ${identifierOnly} AND (strpos(d.title,${text})>0 OR strpos(d.description,${text})>0
      OR (d."sourceCompanyId"=${compound?.[1] ?? ""} AND d."sourceListId"=${compound?.[2] ?? ""})
      OR d.document @@ q.primary_query))
    ORDER BY CASE WHEN d."sourceCompanyId"=${compound?.[1] ?? ""} AND d."sourceListId"=${compound?.[2] ?? ""} THEN 0
      WHEN d."sourceListId"=${text} THEN 1 WHEN d.title=${text} THEN 2
      WHEN strpos(d.title,${text})>0 THEN 3 ELSE 4 END,
      CASE WHEN EXISTS (SELECT 1 FROM unnest(${search.phrases}::text[]) phrase WHERE strpos(d.title,phrase)>0) THEN 0 ELSE 1 END,
      COALESCE(ts_rank(d.document,q.primary_query),0) DESC,
      COALESCE(ts_rank(d.document,q.full_query),0) DESC,
      d.name,d."sourceCompanyId",d."sourceListId",d.id
    LIMIT ${args.limit}`;
  if (!ids.length) {
    return [];
  }
  const selected = ids.map((row) => row.id);
  const rows = await productClient<JoinedRow[]>`
    SELECT d.id,d.version,d.name,d.description,d.normalized,
      b.id AS "bindingId",b."farmId",b.version AS "bindingVersion",b.config,b.provenance
    FROM "RuleDefinition" d JOIN "RuleBinding" b ON b."ruleId"=d.id
    WHERE (${activeSourceCompanyId()}::text IS NULL OR d."sourceCompanyId"=${activeSourceCompanyId()}) AND d.id=ANY(${selected}::uuid[]) AND b.enabled AND b."farmId"=ANY(${allowed}::uuid[])
    ORDER BY d.id,b."farmId",b.version,b.id`;
  const stillAllowed = new Set(await scope(args.userId, args.farmIds));
  return selected.flatMap((ruleId) => {
    const visible = rows.filter(
      (row) => row.id === ruleId && stillAllowed.has(row.farmId)
    );
    if (!visible.length) {
      return [];
    }
    const [first] = visible;
    const bindings = currentBindings(
      visible.map((row) => bindingFrom(row, registry))
    );
    return [
      {
        compileReady: bindings.some((binding) => binding.compileReady),
        description: first.description,
        diagnosticCodes: [
          ...new Set(
            bindings.flatMap((binding) =>
              binding.diagnostics.map((diagnostic) => diagnostic.code)
            )
          ),
        ].sort(),
        farmIds: [...new Set(bindings.map((binding) => binding.farmId))],
        name: first.name,
        queryVerified: false as const,
        ruleId,
        sourceCompanyId: first.normalized.source.companyId,
        sourceListId: first.normalized.source.listId,
        version: first.version,
      },
    ];
  });
}
