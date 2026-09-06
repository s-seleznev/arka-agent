import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { farmErrorStatus, publicFarmError } from "@/lib/farm/errors";
import {
  legacyReportViewPatchSchema,
  reportViewPatchSchema,
  viewOperationsSchema,
} from "@/lib/farm/types";
import { migrateLegacyPatch, ViewValidationError } from "@/lib/farm/view-model";
import {
  applySavedViewOperations,
  patchSavedView,
  refreshSavedViewSnapshot,
  ViewRevisionConflictError,
} from "@/lib/farm/views";

const requestSchema = z.union([
  z
    .object({
      action: z.literal("refresh_snapshot"),
      expectedRevision: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      expectedRevision: z.number().int().nonnegative(),
      operations: viewOperationsSchema,
    })
    .strict(),
  z
    .object({
      expectedRevision: z.number().int().nonnegative(),
      patch: z.union([reportViewPatchSchema, legacyReportViewPatchSchema]),
    })
    .strict(),
]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  try {
    const { id } = await params;
    const input = requestSchema.parse(await request.json());
    const viewId = z.uuid().parse(id);
    const view =
      "action" in input
        ? await refreshSavedViewSnapshot({
            expectedRevision: input.expectedRevision,
            id: viewId,
            userId: session.user.id,
          })
        : "operations" in input
          ? await applySavedViewOperations({
              expectedRevision: input.expectedRevision,
              id: viewId,
              operations: input.operations,
              userId: session.user.id,
            })
          : await patchSavedView({
              expectedRevision: input.expectedRevision,
              id: viewId,
              patch: reportViewPatchSchema.safeParse(input.patch).success
                ? reportViewPatchSchema.parse(input.patch)
                : migrateLegacyPatch(
                    legacyReportViewPatchSchema.parse(input.patch)
                  ),
              userId: session.user.id,
            });
    return Response.json({ view });
  } catch (error) {
    if (error instanceof ViewRevisionConflictError) {
      return Response.json(
        { current: error.current, error: error.message },
        { status: 409 }
      );
    }
    if (error instanceof ViewValidationError) {
      return Response.json(
        { error: error.code, path: error.path },
        { status: 400 }
      );
    }
    if (error instanceof z.ZodError) {
      const [issue] = error.issues;
      return Response.json(
        {
          error: "INVALID_VIEW_OPERATION",
          path: issue?.path.join(".") ?? "",
        },
        { status: 400 }
      );
    }
    const failure = publicFarmError(error, "VIEW_UPDATE_FAILED");
    return Response.json(
      { error: failure.code },
      { status: farmErrorStatus(failure.code) }
    );
  }
}
