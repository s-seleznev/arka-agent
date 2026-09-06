import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { farmErrorStatus, publicFarmError } from "@/lib/farm/errors";
import {
  buildCsvExport,
  buildPrintExport,
  FarmExportError,
} from "@/lib/farm/export";
import { getSavedView } from "@/lib/farm/views";

const querySchema = z.object({
  format: z.enum(["csv", "print"]),
  revision: z.coerce.number().int().nonnegative(),
});

function printError(message: string, status: number, request: Request) {
  const url = new URL(request.url);
  url.searchParams.set("format", "csv");
  const safe = message
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Экспорт недоступен</title><style>body{font:16px -apple-system,sans-serif;margin:40px;max-width:680px}a{display:inline-block;margin-top:16px;padding:10px 14px;background:#17202a;color:white;border-radius:6px;text-decoration:none}</style><h1>Экспорт недоступен</h1><p>${safe}</p><a href="${url.toString()}">Скачать CSV</a>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" }, status }
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const requestedFormat = new URL(request.url).searchParams.get("format");
  if (!session?.user)
    return requestedFormat === "print"
      ? printError("Требуется авторизация.", 401, request)
      : Response.json(
          { error: "UNAUTHORIZED", message: "Требуется авторизация." },
          { status: 401 }
        );
  let format: "csv" | "print" = requestedFormat === "print" ? "print" : "csv";
  try {
    const input = querySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams)
    );
    format = input.format;
    const id = z.uuid().parse((await params).id);
    const view = await getSavedView({ id, userId: session.user.id });
    if (!view)
      return format === "print"
        ? printError("Представление не найдено.", 404, request)
        : Response.json(
            { error: "VIEW_NOT_FOUND", message: "Представление не найдено." },
            { status: 404 }
          );
    if (input.revision !== view.revision) {
      return format === "print"
        ? printError(
            "Представление изменилось. Обновите таблицу и повторите печать.",
            409,
            request
          )
        : Response.json(
            {
              error: "VIEW_REVISION_CONFLICT",
              message: "Представление изменилось. Обновите таблицу.",
              currentRevision: view.revision,
            },
            { status: 409 }
          );
    }
    const result =
      input.format === "csv"
        ? await buildCsvExport(view, session.user.id)
        : await buildPrintExport(view, session.user.id);
    const contentType =
      input.format === "csv"
        ? "text/csv; charset=utf-8"
        : "text/html; charset=utf-8";
    return new Response(result.body, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `${input.format === "csv" ? "attachment" : "inline"}; filename="${result.filename}"`,
        "Content-Type": contentType,
        "X-Arka-Export-Rows": String(result.rows),
        "X-Arka-Snapshot": result.snapshot,
      },
    });
  } catch (error) {
    if (error instanceof FarmExportError) {
      const message =
        error.code === "EXPORT_PRINT_TOO_LARGE"
          ? `Печатная версия ограничена ${error.details?.maxRows ?? 10000} строками.`
          : "Экспорт слишком большой.";
      return format === "print"
        ? printError(message, 413, request)
        : Response.json(
            { error: error.code, message, ...error.details },
            { status: 413 }
          );
    }
    const failure = publicFarmError(error, "ANIMAL_EXPORT_FAILED");
    const status = farmErrorStatus(failure.code);
    return format === "print"
      ? printError(
          `Не удалось подготовить экспорт: ${failure.code}.`,
          status,
          request
        )
      : Response.json(
          {
            error: failure.code,
            message: `Не удалось подготовить экспорт: ${failure.code}.`,
            ...("path" in failure ? { path: failure.path } : {}),
          },
          { status }
        );
  }
}
