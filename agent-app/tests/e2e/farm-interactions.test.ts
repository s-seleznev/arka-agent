import { expect, type Page, test } from "@playwright/test";

test.use({ viewport: { height: 900, width: 1440 } });

function isApiPath(url: string, path: string) {
  return new URL(url).pathname === path;
}

async function openWorkspace(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("farm-workspace")).toBeVisible();
  await expect(page.getByTestId("farm-row-count")).toHaveText("8500 животных");
}

test("keeps row selection controls hidden", async ({ page }) => {
  await openWorkspace(page);
  await expect(page.getByRole("checkbox")).toHaveCount(0);

  await page.route("**/api/chat", async (route) => {
    await route.abort();
  });
  const chatRequest = page.waitForRequest((request) =>
    isApiPath(request.url(), "/api/chat")
  );
  await page.getByTestId("multimodal-input").fill("Проверь выбор");
  await page.getByTestId("send-button").click();
  const selectedIds = (await chatRequest).postDataJSON().viewContext
    .selectedIds as string[];
  expect(selectedIds).toEqual([]);
});

test("opens the animal Sheet by mouse and keyboard and restores focus", async ({
  page,
}) => {
  await openWorkspace(page);

  const numberLink = page.getByTestId("animal-number-link").first();
  const cell = numberLink.locator('xpath=ancestor::*[@role="gridcell"]');
  const iconButton = cell.getByTestId("animal-card-button");
  await expect(iconButton).toHaveCSS("visibility", "hidden");
  await expect(iconButton).toHaveCSS("opacity", "0");
  await cell.hover();
  await expect(iconButton).toHaveCSS("visibility", "visible");
  await expect(iconButton).toHaveCSS("opacity", "1");

  const iconBackground = await iconButton.evaluate(
    (element) => getComputedStyle(element).backgroundColor
  );
  await iconButton.hover();
  await expect
    .poll(() =>
      iconButton.evaluate(
        (element) => getComputedStyle(element).backgroundColor
      )
    )
    .not.toBe(iconBackground);

  const numberText = numberLink.locator("span").first();
  await numberText.hover();
  await expect(numberLink).toHaveCSS("text-decoration-line", "underline");
  await iconButton.focus();
  await expect(iconButton).toBeFocused();
  expect(
    await iconButton.evaluate((element) => element.matches(":focus-visible"))
  ).toBe(true);
  await expect(iconButton).toHaveCSS("opacity", "1");

  const keyboardDetails = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      isApiPath(response.url(), "/api/farm/animal")
  );
  await iconButton.press("Enter");
  await keyboardDetails;
  const sheet = page.getByTestId("animal-card");
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute("data-slot", "sheet-content");
  await expect(sheet).toHaveAttribute("data-side", "right");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(iconButton).toBeFocused();

  const mouseDetails = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      isApiPath(response.url(), "/api/farm/animal")
  );
  await numberLink.click();
  await mouseDetails;
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();
  await expect(numberLink).toBeFocused();
});
