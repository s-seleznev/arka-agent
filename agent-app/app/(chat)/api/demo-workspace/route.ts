import { auth } from "@/app/(auth)/auth";
import { ensureWelcomeWorkspace } from "@/lib/demo/workspace";
import { farmErrorStatus, publicFarmError } from "@/lib/farm/errors";

export async function POST() {
  const session = await auth();
  if (!session?.user)
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (process.env.DEMO_WELCOME_ENABLED !== "1")
    return Response.json({ enabled: false });
  try {
    return Response.json(
      { enabled: true, ...(await ensureWelcomeWorkspace(session.user.id)) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const failure = publicFarmError(error, "DEMO_WORKSPACE_FAILED");
    return Response.json(
      { error: failure.code },
      {
        status:
          failure.code === "DEMO_WORKSPACE_FAILED"
            ? 500
            : farmErrorStatus(failure.code),
      }
    );
  }
}
