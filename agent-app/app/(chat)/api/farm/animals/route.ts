import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { farmErrorStatus, publicFarmError } from "@/lib/farm/errors";
import { queryAnimals } from "@/lib/farm/queries";
import { groupPathSchema } from "@/lib/farm/types";
import { getSavedView } from "@/lib/farm/views";

const requestSchema = z.object({
  cursor: z.string().max(4096).nullish(),
  groupPath: groupPathSchema.default([]),
  limit: z.number().int().min(1).max(200).default(50),
  viewId: z.uuid(),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  try {
    const input = requestSchema.parse(await request.json());
    const view = await getSavedView({
      id: input.viewId,
      userId: session.user.id,
    });
    if (!view) {
      return Response.json({ error: "VIEW_NOT_FOUND" }, { status: 404 });
    }
    const page = await queryAnimals({
      columns: view.columns,
      cursor: input.cursor,
      filters: view.filters,
      groupBy: view.groupBy,
      groupPath: input.groupPath,
      limit: input.limit,
      revision: view.revision,
      ruleContext: view.ruleContext,
      sort: view.sort,
      userId: session.user.id,
      viewId: view.id,
    });
    return Response.json({ page, revision: view.revision });
  } catch (error) {
    const failure = publicFarmError(error, "ANIMAL_QUERY_FAILED");
    return Response.json(
      {
        error: failure.code,
        ...("path" in failure ? { path: failure.path } : {}),
      },
      { status: farmErrorStatus(failure.code) }
    );
  }
}
