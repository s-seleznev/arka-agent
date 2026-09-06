import "server-only";

import {
  createReportView,
  getChatById,
  getLatestReportViewByChat,
  getReportViewById,
  migrateReportViewToLatest,
  saveChat,
  updateReportView,
} from "@/lib/db/queries";
import type { ReportView } from "@/lib/db/schema";
import { type FieldRegistry, farmFields } from "./fields";
import {
  assertFarmAccess,
  assertFilterFarmAccess,
  queryAnimals,
} from "./queries";
import { getAuthorizedFieldRegistry } from "./registry";
import type {
  ReportViewPatch,
  ReportViewState,
  RuleContext,
  ViewOperation,
} from "./types";
import {
  reportViewPatchSchema,
  ruleContextSchema,
  viewOperationsSchema,
} from "./types";
import {
  applyViewOperations,
  createEmptyFilterGroup,
  normalizeStoredReportView,
  sameReportViewContent,
  validateReportViewState,
} from "./view-model";

export class ViewRevisionConflictError extends Error {
  current: ReportViewState | null;

  constructor(current: ReportViewState | null) {
    super("VIEW_REVISION_CONFLICT");
    this.current = current;
  }
}

export function toReportViewState(
  view: ReportView,
  registry: FieldRegistry = farmFields
): ReportViewState {
  return normalizeStoredReportView(view, registry).view;
}

async function ensureLatestReportView(
  view: ReportView,
  userId: string
): Promise<ReportViewState> {
  const registry = await getAuthorizedFieldRegistry(
    userId,
    view.ruleContext?.asOf
  );
  const normalized = normalizeStoredReportView(view, registry);
  if (!normalized.migrated) {
    return normalized.view;
  }
  const migrated = await migrateReportViewToLatest({
    expectedRevision: view.revision,
    id: view.id,
    state: normalized.view,
    userId,
  });
  if (migrated) {
    return normalizeStoredReportView(migrated, registry).view;
  }

  const current = await getReportViewById({ id: view.id, userId });
  if (!current) {
    throw new Error("VIEW_NOT_FOUND");
  }
  return normalizeStoredReportView(current, registry).view;
}

function statePatch(
  state: ReportViewState
): ReportViewPatch & { ruleContext: RuleContext | null } {
  return {
    columns: state.columns,
    filters: state.filters,
    groupBy: state.groupBy,
    ruleContext: state.ruleContext ?? null,
    sort: state.sort,
  };
}

async function ensureChat(view: ReportViewState, userId: string) {
  const chat = await getChatById({ id: view.chatId });
  if (chat) {
    if (chat.userId !== userId) {
      throw new Error("VIEW_CHAT_OWNERSHIP_CONFLICT");
    }
    return;
  }
  await saveChat({
    id: view.chatId,
    title: "Новая задача",
    userId,
    visibility: "private",
  });
  const created = await getChatById({ id: view.chatId });
  if (created?.userId !== userId) {
    throw new Error("VIEW_CHAT_OWNERSHIP_CONFLICT");
  }
}

export function validateReportViewPatch(
  current: ReportViewState,
  patch: ReportViewPatch,
  registry: FieldRegistry = farmFields
) {
  const parsed = reportViewPatchSchema.parse(patch);
  return validateReportViewState({ ...current, ...parsed }, registry);
}

export async function createDefaultView({
  chatId,
  farmId,
  userId,
}: {
  chatId: string;
  farmId: string;
  userId: string;
}) {
  await assertFarmAccess(userId, farmId);
  const existing = await getLatestReportViewByChat({ chatId, userId });
  if (existing) {
    const view = await ensureLatestReportView(existing, userId);
    await assertFilterFarmAccess(userId, view.filters, view.ruleContext?.asOf);
    await ensureChat(view, userId);
    return view;
  }
  const created = await createReportView({ chatId, farmId, userId });
  const view = await ensureLatestReportView(created, userId);
  await ensureChat(view, userId);
  return view;
}

export async function getSavedView({
  id,
  userId,
}: {
  id: string;
  userId: string;
}) {
  const stored = await getReportViewById({ id, userId });
  if (!stored) {
    return null;
  }
  const view = await ensureLatestReportView(stored, userId);
  await assertFilterFarmAccess(userId, view.filters, view.ruleContext?.asOf);
  await ensureChat(view, userId);
  return view;
}

export async function getSavedViewForChat({
  chatId,
  userId,
}: {
  chatId: string;
  userId: string;
}) {
  const stored = await getLatestReportViewByChat({ chatId, userId });
  if (!stored) {
    return null;
  }
  const view = await ensureLatestReportView(stored, userId);
  await assertFilterFarmAccess(userId, view.filters, view.ruleContext?.asOf);
  await ensureChat(view, userId);
  return view;
}

async function saveNextView({
  current,
  expectedRevision,
  next,
  userId,
  refreshSnapshot = false,
}: {
  current: ReportViewState;
  expectedRevision: number;
  next: ReportViewState;
  userId: string;
  refreshSnapshot?: boolean;
}) {
  if (expectedRevision !== current.revision) {
    throw new ViewRevisionConflictError(current);
  }
  if (sameReportViewContent(current, next)) {
    return current;
  }
  if (refreshSnapshot && next.ruleContext) {
    next = await withCurrentSnapshot(next, userId);
  }
  await assertFilterFarmAccess(userId, next.filters, next.ruleContext?.asOf);
  const updated = await updateReportView({
    expectedRevision,
    id: current.id,
    patch: statePatch(next),
    userId,
  });
  if (!updated) {
    throw new ViewRevisionConflictError(
      await getSavedView({ id: current.id, userId })
    );
  }
  const state = toReportViewState(
    updated,
    await getAuthorizedFieldRegistry(userId, next.ruleContext?.asOf)
  );
  await ensureChat(state, userId);
  return state;
}

export async function applySavedViewOperations({
  expectedRevision,
  id,
  operations,
  userId,
}: {
  expectedRevision: number;
  id: string;
  operations: ViewOperation[];
  userId: string;
}) {
  const current = await getSavedView({ id, userId });
  if (!current) {
    throw new Error("VIEW_NOT_FOUND");
  }
  const parsed = viewOperationsSchema.parse(operations);
  const next = applyViewOperations(
    current,
    parsed,
    await getAuthorizedFieldRegistry(userId)
  );
  return saveNextView({
    current,
    expectedRevision,
    next,
    refreshSnapshot: true,
    userId,
  });
}

export async function patchSavedView({
  expectedRevision,
  id,
  patch,
  userId,
}: {
  expectedRevision: number;
  id: string;
  patch: ReportViewPatch;
  userId: string;
}) {
  const current = await getSavedView({ id, userId });
  if (!current) {
    throw new Error("VIEW_NOT_FOUND");
  }
  const next = validateReportViewPatch(
    current,
    patch,
    await getAuthorizedFieldRegistry(userId)
  );
  if (current.ruleContext && !sameReportViewContent(current, next)) {
    next.ruleContext = { ...current.ruleContext, modified: true };
  }
  return saveNextView({
    current,
    expectedRevision,
    next,
    refreshSnapshot: true,
    userId,
  });
}

/** Refresh the facts cut, never reconstruct the user's conditions from a source rule. */
async function withCurrentSnapshot(state: ReportViewState, userId: string) {
  const asOf = new Date().toISOString();
  const page = await queryAnimals({
    asOf,
    columns: state.columns,
    filters: state.filters,
    groupBy: state.groupBy,
    limit: 1,
    revision: state.revision,
    sort: state.sort,
    userId,
    viewId: state.id,
  });
  return state.ruleContext
    ? {
        ...state,
        ruleContext: {
          ...state.ruleContext,
          asOf: page.asOf ?? asOf,
          snapshot: page.snapshot,
        },
      }
    : state;
}

export async function refreshSavedViewSnapshot({
  id,
  userId,
  expectedRevision,
}: {
  id: string;
  userId: string;
  expectedRevision: number;
}) {
  const current = await getSavedView({ id, userId });
  if (!current) {
    throw new Error("VIEW_NOT_FOUND");
  }
  if (current.revision !== expectedRevision) {
    throw new ViewRevisionConflictError(current);
  }
  const next = await withCurrentSnapshot(current, userId);
  return saveNextView({ current, expectedRevision, next, userId });
}

/** Internal only: public view patches cannot forge a source-rule attachment. */
export async function applyRuleView({
  id,
  userId,
  expectedRevision,
  patch,
  context,
}: {
  id: string;
  userId: string;
  expectedRevision: number;
  patch: ReportViewPatch;
  context: RuleContext;
}) {
  const current = await getSavedView({ id, userId });
  if (!current) {
    throw new Error("VIEW_NOT_FOUND");
  }
  const next = validateReportViewPatch(
    current,
    patch,
    await getAuthorizedFieldRegistry(userId)
  );
  next.ruleContext = ruleContextSchema.parse(context);
  return saveNextView({ current, expectedRevision, next, userId });
}

export const emptyFilters = createEmptyFilterGroup();
