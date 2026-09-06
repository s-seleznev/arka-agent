import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { farmErrorStatus, publicFarmError } from "@/lib/farm/errors";
import { getAnimalById } from "@/lib/farm/queries";
import { getSavedView } from "@/lib/farm/views";

const requestSchema = z.object({
  animalId: z.uuid(),
  farmId: z.uuid(),
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
    const animal = await getAnimalById({
      animalId: input.animalId,
      farmId: input.farmId,
      userId: session.user.id,
    });
    return animal
      ? Response.json({ animal })
      : Response.json({ error: "ANIMAL_NOT_FOUND" }, { status: 404 });
  } catch (error) {
    const failure = publicFarmError(error, "ANIMAL_READ_FAILED");
    return Response.json(
      { error: failure.code },
      { status: farmErrorStatus(failure.code) }
    );
  }
}
