import { expect, test } from "@playwright/test";

test.use({ viewport: { height: 900, width: 1440 } });

test("agent applies the same filter tree as the table controls", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("farm-row-count")).toHaveText("8500 животных");
  const targetFarm = await page.evaluate(async () => {
    const response = await fetch("/api/farms");
    const payload = (await response.json()) as {
      farms: Array<{ id: string; name: string }>;
    };
    const [, target] = payload.farms;
    if (!target) {
      throw new Error("Second test farm is required");
    }
    return target;
  });

  const chatRequest = page.waitForRequest(
    (request) => new URL(request.url()).pathname === "/api/chat"
  );
  await page
    .getByTestId("multimodal-input")
    .fill(`TEST_AGENT_VIEW_UPDATE TARGET_FARM_ID=${targetFarm.id}`);
  await page.getByTestId("send-button").click();
  expect((await chatRequest).postDataJSON().viewContext).toBeDefined();

  const filtering = page.getByTestId("farm-filtering");
  await expect(filtering).toContainText("2");
  await expect(page.getByTestId("farm-sorting")).toContainText("2");
  await expect(page.getByTestId("farm-grouping")).toContainText("1");

  await filtering.click();
  const applied = page.getByTestId("farm-applied-rules");
  const chips = applied.getByTestId("farm-filter-chip");
  await expect(chips).toHaveCount(2);
  await expect(chips.filter({ hasText: targetFarm.name })).toBeVisible();
  await expect(chips.filter({ hasText: "Стельная равно Да" })).toBeVisible();
  await expect(applied.getByText(/Сортировка|Группировка/)).toHaveCount(0);
  await expect(applied.getByTestId("farm-add-filter")).toBeVisible();
  await expect(
    page.getByText("Расширенный фильтр", { exact: true })
  ).toHaveCount(0);

  await expect(page.getByRole("treegrid")).toBeVisible();
  await expect(page.getByTestId("farm-row-count")).toHaveText(/^\d+ животных$/);
});
