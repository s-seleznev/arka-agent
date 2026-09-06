import { expect, type Page, test } from "@playwright/test";

test.use({ viewport: { height: 900, width: 1440 } });

function requireBox<T>(value: T | null, label: string): T {
  if (value === null) {
    throw new Error(`${label} has no bounding box`);
  }
  return value;
}

async function openWorkspace(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("farm-workspace")).toBeVisible();
}

async function ensureSidebarExpanded(page: Page) {
  const openButton = page.getByRole("button", {
    name: "Открыть боковое меню",
  });
  if (await openButton.isVisible()) {
    await openButton.click();
  }
  await expect(
    page.getByRole("button", { name: "Закрыть боковое меню" })
  ).toBeVisible();
}

test("sidebar toggle only changes the sidebar and does not navigate", async ({
  page,
}) => {
  await openWorkspace(page);
  const initialUrl = page.url();

  await ensureSidebarExpanded(page);
  await expect(page).toHaveURL(initialUrl);

  await page.getByRole("button", { name: "Закрыть боковое меню" }).click();
  const openButton = page.getByRole("button", { name: "Открыть боковое меню" });
  await expect(openButton).toBeVisible();
  await expect
    .poll(
      async () =>
        (await page.locator('[data-slot="sidebar-container"]').boundingBox())
          ?.width ?? 0
    )
    .toBeCloseTo(46, 0);
  const collapsedSidebar = requireBox(
    await page.locator('[data-slot="sidebar-container"]').boundingBox(),
    "collapsed sidebar"
  );
  const openButtonBox = requireBox(
    await openButton.boundingBox(),
    "collapsed sidebar toggle"
  );
  const newChatBox = requireBox(
    await page.getByRole("button", { name: "Новый чат" }).boundingBox(),
    "collapsed new chat"
  );
  expect(collapsedSidebar.width).toBeCloseTo(46, 0);
  const collapsedGap = requireBox(
    await page.locator('[data-slot="sidebar-gap"]').boundingBox(),
    "collapsed sidebar gap"
  );
  expect(collapsedGap.width).toBeCloseTo(46, 0);
  expect(
    Math.abs(
      openButtonBox.x +
        openButtonBox.width / 2 -
        (newChatBox.x + newChatBox.width / 2)
    )
  ).toBeLessThan(1);
  expect(
    Math.abs(
      openButtonBox.x +
        openButtonBox.width / 2 -
        (collapsedSidebar.x + collapsedSidebar.width / 2)
    )
  ).toBeLessThan(1);
  const footerFits = await page
    .locator('[data-slot="sidebar-footer"]')
    .evaluate(
      (footer) =>
        footer.scrollWidth <= footer.clientWidth && footer.clientWidth === 46
    );
  expect(footerFits).toBe(true);
  await expect(page).toHaveURL(initialUrl);
});

test("shell uses the prototype theme and only shows the chat title", async ({
  page,
}) => {
  await openWorkspace(page);
  await ensureSidebarExpanded(page);

  const header = page.getByTestId("chat-header");
  const headerBox = requireBox(await header.boundingBox(), "chat header");
  expect(headerBox.y).toBeLessThan(1);
  const topBarBoxes = await Promise.all([
    page.locator('[data-slot="sidebar-header"]').boundingBox(),
    header.boundingBox(),
    page.getByTestId("farm-toolbar").boundingBox(),
  ]);
  const topBars = topBarBoxes.map((box, index) =>
    requireBox(box, `top bar ${index + 1}`)
  );
  for (const box of topBars) {
    expect(box.y).toBeLessThan(1);
    expect(box.height).toBeCloseTo(46, 0);
  }
  const bottoms = topBars.map((box) => box.y + box.height);
  expect(Math.max(...bottoms) - Math.min(...bottoms)).toBeLessThan(1);
  await expect(page.getByLabel("Название чата")).toHaveValue("Новый чат");
  await expect(page.getByRole("button", { name: "Удалить все" })).toHaveCount(
    0
  );
  await expect(page.getByText("Доступ", { exact: true })).toHaveCount(0);

  const theme = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return {
      accent: root.getPropertyValue("--accent-default").trim(),
      font: getComputedStyle(document.body).fontFamily,
      radius: root.getPropertyValue("--radius-buttons").trim(),
    };
  });
  expect(theme.accent).toBe("#f76707");
  expect(theme.font).toContain("-apple-system");
  expect(theme.radius).toBe("8px");

  const inset = requireBox(
    await page.locator('[data-slot="sidebar-inset"]').boundingBox(),
    "sidebar inset"
  );
  expect(inset.x + inset.width).toBeLessThanOrEqual(1440.5);
});

test("sidebar width can be resized", async ({ page }) => {
  await openWorkspace(page);
  await ensureSidebarExpanded(page);

  const sidebar = page.locator('[data-slot="sidebar-container"]');
  const sidebarHandle = page.getByTestId("sidebar-resize-handle");
  await expect
    .poll(async () => (await sidebar.boundingBox())?.width ?? 0)
    .toBeCloseTo(248, 0);
  const sidebarBefore = requireBox(await sidebar.boundingBox(), "sidebar");
  const restingHandleColor = await sidebarHandle.evaluate(
    (handle) => getComputedStyle(handle, "::after").backgroundColor
  );
  const sidebarHandleBox = requireBox(
    await sidebarHandle.boundingBox(),
    "sidebar handle"
  );
  await page.mouse.move(
    sidebarHandleBox.x + sidebarHandleBox.width / 2,
    sidebarHandleBox.y + 100
  );
  await page.mouse.down();
  await page.mouse.move(sidebarHandleBox.x + 64, sidebarHandleBox.y + 100);
  await page.mouse.up();
  await page.mouse.move(1400, 20);
  await expect(sidebarHandle).toHaveAttribute("data-resizing", "false");
  await expect
    .poll(() =>
      sidebarHandle.evaluate(
        (handle) => getComputedStyle(handle, "::after").backgroundColor
      )
    )
    .toBe(restingHandleColor);
  await expect
    .poll(async () => (await sidebar.boundingBox())?.width ?? 0)
    .toBeGreaterThan(sidebarBefore.width + 40);

  const resizedWidth = requireBox(await sidebar.boundingBox(), "sidebar").width;
  await expect
    .poll(() =>
      page.evaluate(() =>
        Number(window.localStorage.getItem("arkasha_sidebar_width"))
      )
    )
    .toBeCloseTo(resizedWidth, 0);
  await page.reload();
  await ensureSidebarExpanded(page);
  await expect
    .poll(async () => (await sidebar.boundingBox())?.width ?? 0)
    .toBeCloseTo(resizedWidth, 0);
});

test("chat and workspace widths can be resized", async ({ page }) => {
  await openWorkspace(page);
  const chatHandle = page.getByTestId("chat-resize-handle");
  const chatHandleBox = requireBox(
    await chatHandle.boundingBox(),
    "chat handle"
  );
  const restingHandleColor = await chatHandle.evaluate(
    (handle) => getComputedStyle(handle).backgroundColor
  );
  await page.mouse.move(
    chatHandleBox.x + chatHandleBox.width / 2,
    chatHandleBox.y + chatHandleBox.height / 2
  );
  await page.mouse.down();
  await page.waitForTimeout(100);
  await page.mouse.move(
    chatHandleBox.x + 80,
    chatHandleBox.y + chatHandleBox.height / 2,
    {
      steps: 10,
    }
  );
  await page.mouse.up();
  await page.mouse.move(1400, 20);
  await expect
    .poll(() =>
      chatHandle.evaluate((handle) => getComputedStyle(handle).backgroundColor)
    )
    .toBe(restingHandleColor);
  await expect
    .poll(async () => (await chatHandle.boundingBox())?.x ?? 0)
    .toBeGreaterThan(chatHandleBox.x + 20);

  const resizedX = requireBox(await chatHandle.boundingBox(), "chat handle").x;
  await expect
    .poll(() =>
      page.evaluate(() => {
        const rawLayout = window.localStorage.getItem(
          "react-resizable-panels:arkasha-chat-workspace"
        );
        return rawLayout
          ? Number((JSON.parse(rawLayout) as { chat?: number }).chat ?? 0)
          : 0;
      })
    )
    .toBeGreaterThan(40);
  await page.reload();
  await expect
    .poll(async () => (await chatHandle.boundingBox())?.x ?? 0)
    .toBeCloseTo(resizedX, 0);
});

test("resize handles span the workspace height without a visible grip", async ({
  page,
}) => {
  await openWorkspace(page);
  await ensureSidebarExpanded(page);

  const sidebarHandle = page.getByTestId("sidebar-resize-handle");
  const chatHandle = page.getByTestId("chat-resize-handle");
  const [sidebarBox, chatBox] = await Promise.all([
    sidebarHandle.boundingBox(),
    chatHandle.boundingBox(),
  ]);

  expect(requireBox(sidebarBox, "sidebar handle").height).toBeGreaterThan(895);
  const chatHandleBox = requireBox(chatBox, "chat handle");
  expect(chatHandleBox.height).toBeGreaterThan(895);
  expect(chatHandleBox.width).toBeLessThanOrEqual(1.5);
  await expect(page.locator('[data-slot="resizable-handle-grip"]')).toHaveCount(
    0
  );

  const dividers = await page.evaluate(() => {
    const style = (selector: string, pseudo?: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) {
        throw new Error(`Missing divider element: ${selector}`);
      }
      return getComputedStyle(element, pseudo);
    };
    const sidebarHeader = style('[data-slot="sidebar-header"]');
    const chatHeader = style('[data-testid="chat-header"]');
    const farmToolbar = style('[data-testid="farm-toolbar"]');
    const chatResize = style('[data-testid="chat-resize-handle"]');
    const sidebarResize = style(
      '[data-testid="sidebar-resize-handle"]',
      "::after"
    );
    const grid = style(".farm-data-grid");
    const gridCell = style('.farm-data-grid [role="columnheader"]');
    const workspace = style('[data-testid="farm-workspace"]');

    return {
      colors: [
        sidebarHeader.borderBottomColor,
        chatHeader.borderBottomColor,
        farmToolbar.borderBottomColor,
        chatResize.backgroundColor,
        sidebarResize.backgroundColor,
        gridCell.borderInlineEndColor,
        gridCell.borderBottomColor,
      ],
      frozenShadow: grid.getPropertyValue("--rdg-cell-frozen-box-shadow"),
      gridBorder: grid.borderLeftWidth,
      widths: [
        sidebarHeader.borderBottomWidth,
        chatHeader.borderBottomWidth,
        farmToolbar.borderBottomWidth,
        chatResize.width,
        sidebarResize.width,
        gridCell.borderInlineEndWidth,
        gridCell.borderBottomWidth,
      ],
      workspaceBorder: workspace.borderLeftWidth,
    };
  });

  expect(new Set(dividers.colors).size).toBe(1);
  expect(new Set(dividers.widths)).toEqual(new Set(["1px"]));
  expect(dividers.frozenShadow).toBe("none");
  expect(dividers.gridBorder).toBe("0px");
  expect(dividers.workspaceBorder).toBe("0px");
});

test("chat title persists and the active sidebar row reflects it", async ({
  page,
}) => {
  await openWorkspace(page);
  await page.getByTestId("multimodal-input").fill("Создай тестовый чат");
  await page.getByTestId("send-button").click();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]+$/);
  await ensureSidebarExpanded(page);

  const title = `Отчёт по стаду ${Date.now()}`;
  const titleInput = page.getByLabel("Название чата");
  await expect(titleInput).toBeEditable();
  await titleInput.fill(title);
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/chat") &&
      response.request().method() === "PATCH"
  );
  await titleInput.press("Enter");
  await expect((await saved).status()).toBe(200);

  const activeRow = page.locator(
    '[data-slot="sidebar-menu-button"][data-active="true"]'
  );
  await expect(activeRow).toHaveText(title);
  await expect(activeRow).toHaveAttribute("aria-current", "page");

  const activeBackground = await activeRow.evaluate(
    (element) => getComputedStyle(element).backgroundColor
  );
  await activeRow.hover();
  await expect
    .poll(() =>
      activeRow.evaluate((element) => getComputedStyle(element).backgroundColor)
    )
    .not.toBe(activeBackground);
  await activeRow.focus();
  await expect
    .poll(() =>
      activeRow.evaluate((element) => getComputedStyle(element).boxShadow)
    )
    .not.toBe("none");

  await page.reload();
  await expect(page.getByLabel("Название чата")).toHaveValue(title);
});

test("animal number remains frozen during horizontal scrolling", async ({
  page,
}) => {
  await openWorkspace(page);

  const grid = page.getByRole("grid");
  const numberCell = page
    .getByRole("button", { name: /^Открыть карточку животного/ })
    .first()
    .locator('xpath=ancestor::*[@role="gridcell"]');
  const before = requireBox(await numberCell.boundingBox(), "number cell");
  await grid.evaluate((element) => {
    element.scrollLeft = 600;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await expect
    .poll(() => grid.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);
  const after = requireBox(
    await numberCell.boundingBox(),
    "number cell after scroll"
  );
  expect(Math.abs(after.x - before.x)).toBeLessThan(2);
});
