import { expect, test } from "@playwright/test";

test.describe("Model Selector", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("displays a model button", async ({ page }) => {
    const modelButton = page.getByTestId("model-selector");
    await expect(modelButton).toBeVisible();
  });

  test("opens model selector popover on click", async ({ page }) => {
    const modelButton = page.getByTestId("model-selector");
    await modelButton.click();

    await expect(page.getByPlaceholder("Найти модель...")).toBeVisible();
  });

  test("can search for models", async ({ page }) => {
    const modelButton = page.getByTestId("model-selector");
    await modelButton.click();

    const searchInput = page.getByPlaceholder("Найти модель...");
    await searchInput.fill("Аркаша");

    await expect(page.getByRole("option", { name: /Аркаша/ })).toBeVisible();
  });

  test("can close model selector by clicking outside", async ({ page }) => {
    const modelButton = page.getByTestId("model-selector");
    await modelButton.click();

    await expect(page.getByPlaceholder("Найти модель...")).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(page.getByPlaceholder("Найти модель...")).not.toBeVisible();
  });

  test("shows available models", async ({ page }) => {
    const modelButton = page.getByTestId("model-selector");
    await modelButton.click();

    const availableModels = page.getByRole("group", { name: "Доступно" });
    await expect(availableModels).toBeVisible();
    await expect(
      availableModels.getByRole("option", { name: /Аркаша/ })
    ).toBeVisible();
  });

  test("can select an available model", async ({ page }) => {
    const modelButton = page.getByTestId("model-selector");
    await modelButton.click();

    await page.getByRole("option", { name: /Аркаша/ }).click();

    await expect(page.getByPlaceholder("Найти модель...")).not.toBeVisible();
    await expect(modelButton).toContainText("Аркаша");
  });
});
