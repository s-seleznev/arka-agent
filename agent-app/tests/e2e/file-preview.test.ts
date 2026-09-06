import { expect, test } from "@playwright/test";

test("uploads a document and opens it in the workspace preview", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      buffer: Buffer.from("Arkasha document preview test"),
      mimeType: "text/markdown",
      name: "arkasha-preview.md",
    });

  const attachment = page.getByTitle("Открыть arkasha-preview.md");
  await expect(attachment).toBeVisible();
  await attachment.click();

  await expect(page.getByRole("complementary")).toContainText(
    "arkasha-preview.md"
  );
  await expect(page.getByRole("button", { name: "Закрыть" })).toBeVisible();
  expect(
    (await page.getByTestId("workspace-preview-header").boundingBox())?.height
  ).toBeCloseTo(46, 0);
  const storedFiles = await page.evaluate(async () => {
    const response = await fetch("/api/files");
    return response.json();
  });
  expect(storedFiles.files).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "arkasha-preview.md" }),
    ])
  );
});
