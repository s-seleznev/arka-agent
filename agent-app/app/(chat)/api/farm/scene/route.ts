import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { farmErrorStatus, publicFarmError } from "@/lib/farm/errors";
import { querySceneAnimals } from "@/lib/farm/queries";
import { getSavedView } from "@/lib/farm/views";

const schema = z.object({ viewId: z.uuid(), revision: z.number().int().nonnegative() }).strict();

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  try {
    const input = schema.parse(await request.json());
    const view = await getSavedView({ id: input.viewId, userId: session.user.id });
    if (!view) return Response.json({ error: "VIEW_NOT_FOUND" }, { status: 404 });
    if (view.revision !== input.revision) return Response.json({ error: "VIEW_CHANGED" }, { status: 409 });
    return Response.json(await querySceneAnimals(session.user.id, view), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const failure = publicFarmError(error, "SCENE_QUERY_FAILED");
    return Response.json({ error: failure.code }, { status: farmErrorStatus(failure.code) });
  }
}
