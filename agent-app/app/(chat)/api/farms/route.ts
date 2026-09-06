import { auth } from "@/app/(auth)/auth";
import { getAccessibleFarms, getFarmFieldCatalog } from "@/lib/farm/queries";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  try {
    const farms = await getAccessibleFarms(session.user.id);
    return Response.json({
      farms,
      fields: await getFarmFieldCatalog(session.user.id),
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "FARM_DATABASE_ERROR";
    return Response.json(
      { error: code },
      { status: code === "FARM_DATABASE_NOT_CONFIGURED" ? 503 : 500 }
    );
  }
}
