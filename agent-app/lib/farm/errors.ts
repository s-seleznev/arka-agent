import { z } from "zod";
import { FarmCursorError } from "./cursor";
import { ViewValidationError } from "./view-model";

const publicCodes = new Set([
  "FIELD_REGISTRY_STALE",
  "RULE_PROJECTION_STALE",
  "RULE_SNAPSHOT_STALE",
  "CURSOR_INVALID",
  "CURSOR_STALE",
  "CURSOR_TAMPERED",
  "DUPLICATE_VIEW_COLUMN",
  "DUPLICATE_VIEW_GROUP",
  "DUPLICATE_VIEW_SORT",
  "FARM_ACCESS_DENIED",
  "FARM_DATABASE_NOT_CONFIGURED",
  "FARM_SNAPSHOT_UNAVAILABLE",
  "FILTER_COUNT_EXCEEDED",
  "FILTER_DEPTH_EXCEEDED",
  "INVALID_COLUMN_COUNT",
  "INVALID_GROUP_PATH",
  "INVALID_GROUP_PATH_VALUE",
  "UNKNOWN_FARM_FIELD",
  "UNGROUPABLE_FARM_FIELD",
  "UNSORTABLE_FARM_FIELD",
  "VIEW_NOT_FOUND",
  "SCENE_CAPACITY_EXCEEDED",
]);

export function publicFarmError(error: unknown, fallback: string) {
  if (error instanceof ViewValidationError) {
    return { code: error.code, path: error.path };
  }
  if (error instanceof FarmCursorError) {
    return { code: error.code };
  }
  if (error instanceof z.ZodError) {
    const [issue] = error.issues;
    return {
      code: "INVALID_REQUEST",
      path: issue?.path.join(".") ?? "",
    };
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "57014"
  ) {
    return { code: "FARM_QUERY_TIMEOUT" };
  }
  if (error instanceof Error) {
    const [code] = error.message.split(":", 1);
    if (publicCodes.has(code)) {
      return { code };
    }
  }
  return { code: fallback };
}

export function farmErrorStatus(code: string) {
  if (code === "FARM_ACCESS_DENIED") {
    return 403;
  }
  if (code === "VIEW_NOT_FOUND") {
    return 404;
  }
  if (
    code === "FARM_DATABASE_NOT_CONFIGURED" ||
    code === "FARM_QUERY_TIMEOUT" ||
    code === "FARM_SNAPSHOT_UNAVAILABLE"
  ) {
    return 503;
  }
  return 400;
}
