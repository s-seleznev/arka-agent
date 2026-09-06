import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { farmErrorStatus, publicFarmError } from "@/lib/farm/errors";
import { getFarmFieldValues } from "@/lib/farm/queries";
import { getSavedView } from "@/lib/farm/views";

const requestSchema = z
  .object({
    fieldId: z.string().min(1).max(80),
    limit: z.number().int().min(1).max(200).default(50),
    search: z.string().max(120).optional(),
    viewId: z.uuid(),
  })
  .strict();

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
    const values = await getFarmFieldValues({
      fieldId: input.fieldId,
      limit: input.limit,
      search: input.search,
      userId: session.user.id,
    });
    return Response.json({ values });
  } catch (error) {
    const failure = publicFarmError(error, "FIELD_VALUES_QUERY_FAILED");
    return Response.json(
      {
        error: failure.code,
        ...("path" in failure ? { path: failure.path } : {}),
      },
      { status: farmErrorStatus(failure.code) }
    );
  }
}
