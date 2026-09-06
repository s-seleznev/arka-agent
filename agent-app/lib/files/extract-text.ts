import "server-only";

const MAX_EXTRACTED_CHARACTERS = 500_000;

export async function extractTextFromFile({
  bytes,
  contentType,
}: {
  bytes: ArrayBuffer;
  contentType: string;
}): Promise<{
  text: string | null;
  status: "ready" | "unsupported" | "failed";
}> {
  try {
    let text: string | null = null;

    if (contentType.startsWith("text/") || contentType === "application/json") {
      text = new TextDecoder().decode(bytes);
    } else if (contentType === "application/pdf") {
      const { extractText } = await import("unpdf");
      const result = await extractText(new Uint8Array(bytes), {
        mergePages: true,
      });
      ({ text } = result);
    } else if (
      contentType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({
        buffer: Buffer.from(bytes),
      });
      text = result.value;
    } else if (
      contentType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ) {
      const ExcelJS = await import("exceljs");
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(bytes);
      const rows: string[] = [];
      workbook.eachSheet((sheet) => {
        rows.push(`# ${sheet.name}`);
        sheet.eachRow((row) => {
          const values = Array.isArray(row.values) ? row.values.slice(1) : [];
          rows.push(values.map(String).join("\t"));
        });
      });
      text = rows.join("\n");
    } else {
      return { status: "unsupported", text: null };
    }

    const normalized = text.split(String.fromCharCode(0)).join("").trim();
    return {
      status: "ready",
      text: normalized.slice(0, MAX_EXTRACTED_CHARACTERS),
    };
  } catch {
    return { status: "failed", text: null };
  }
}
