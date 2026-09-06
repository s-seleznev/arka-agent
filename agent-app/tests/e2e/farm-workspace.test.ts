import { expect, type Page, test } from "@playwright/test";
import { REPORT_VIEW_SCHEMA_VERSION } from "../../lib/farm/types";

test.use({ viewport: { height: 900, width: 1440 } });

const animalsPath = "/api/farm/animals";

function isApiPath(url: string, path: string) {
  return new URL(url).pathname === path;
}

async function openWorkspace(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("farm-workspace")).toBeVisible();
  await expect(page.getByTestId("farm-row-count")).toHaveText("8500 животных");
}

async function chooseOption(page: Page, name: string) {
  await page.getByRole("option", { exact: true, name }).click();
}

test("shows the fresh toolbar and persists a typed filter", async ({
  page,
}) => {
  await openWorkspace(page);

  const toolbar = page.getByRole("toolbar", { name: "Настройка выборки" });
  const filtering = page.getByTestId("farm-filtering");
  const sorting = page.getByTestId("farm-sorting");
  const grouping = page.getByTestId("farm-grouping");
  await expect(toolbar.getByRole("button")).toHaveCount(3);
  await expect(filtering).toBeVisible();
  await expect(sorting).toBeVisible();
  await expect(grouping).toBeVisible();
  await expect(page.getByTestId("farm-applied-rules")).toHaveCount(0);
  await expect(page.getByTestId("farm-add-filter")).toHaveCount(0);

  await filtering.focus();
  await filtering.press("ArrowRight");
  await expect(sorting).toBeFocused();
  await sorting.press("ArrowRight");
  await expect(grouping).toBeFocused();

  await filtering.click();
  const applied = page.getByTestId("farm-applied-rules");
  await expect(applied).toBeVisible();
  expect((await applied.boundingBox())?.height).toBeCloseTo(46, 0);
  await expect(applied.getByTestId("farm-filter-chip")).toContainText("Ферма");
  const addFilter = applied.getByTestId("farm-add-filter");
  await expect(addFilter).toBeVisible();
  await expect(page.getByTestId("farm-filter-field")).toHaveCount(0);

  await addFilter.click();
  const fieldPicker = page.getByTestId("farm-filter-field");
  await expect(fieldPicker).toBeVisible();
  await expect(fieldPicker).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("farm-filter-field-search")).toHaveCount(0);
  await fieldPicker.click();
  const fieldSearch = page.getByTestId("farm-filter-field-search");
  await expect(fieldSearch).toBeFocused();
  await fieldSearch.fill("Статус");
  await chooseOption(page, "Статус");

  await expect(page.getByTestId("farm-filter-operator")).toContainText("равно");
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      new URL(response.url()).pathname.startsWith("/api/views/")
  );
  await page.getByTestId("farm-filter-value").click();
  await chooseOption(page, "LACTATING");
  const [operation] = (await saved).request().postDataJSON().operations;
  expect(operation).toMatchObject({
    node: { field: "statusCode", operator: "eq" },
    type: "filter.add",
  });

  await expect(applied).toBeVisible();
  await expect(applied).toContainText("Статус равно LACTATING");
  await expect(applied.getByText(/Сортировка|Группировка/)).toHaveCount(0);
  await expect(
    page.getByText("Расширенный фильтр", { exact: true })
  ).toHaveCount(0);
  await expect(page.getByTestId("farm-row-count")).toHaveText(/^\d+ животных$/);
  const filteredCount = Number.parseInt(
    await page.getByTestId("farm-row-count").innerText(),
    10
  );
  expect(filteredCount).toBeGreaterThan(3000);
  expect(filteredCount).toBeLessThan(4000);

  await page.waitForURL(/\/chat\/[0-9a-f-]+$/);
  await page.reload();
  await expect(page.getByTestId("farm-applied-rules")).toHaveCount(0);
  await page.getByTestId("farm-filtering").click();
  await expect(page.getByTestId("farm-applied-rules")).toContainText(
    "Статус равно LACTATING"
  );
  await expect(page.getByTestId("farm-row-count")).toHaveText(
    `${filteredCount} животных`
  );
});

test("persists flat range, negative and multi-value filters", async ({
  page,
}) => {
  await openWorkspace(page);
  await page.getByTestId("farm-filtering").click();
  const applied = page.getByTestId("farm-applied-rules");
  const addFilter = applied.getByTestId("farm-add-filter");

  const chooseField = async (fieldName: string) => {
    await addFilter.click();
    const fieldPicker = page.getByTestId("farm-filter-field");
    await expect(fieldPicker).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("farm-filter-field-search")).toHaveCount(0);
    await fieldPicker.click();
    await chooseOption(page, fieldName);
  };
  const nextPatch = () =>
    page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        new URL(response.url()).pathname.startsWith("/api/views/")
    );

  await chooseField("Последний вес");
  await page.getByTestId("farm-filter-operator").click();
  await chooseOption(page, "между");
  await page.getByTestId("farm-filter-value").fill("450");
  await page.getByTestId("farm-filter-value-upper").fill("650");
  const rangeSaved = nextPatch();
  await page.getByTestId("farm-filter-value-upper").press("Tab");
  const [rangeOperation] = (await rangeSaved)
    .request()
    .postDataJSON().operations;
  expect(rangeOperation).toMatchObject({
    node: {
      field: "lastWeightKg",
      operator: "between",
      value: {
        lower: { type: "number", value: 450 },
        type: "range",
        upper: { type: "number", value: 650 },
      },
    },
    type: "filter.add",
  });

  await chooseField("Кличка");
  await page.getByTestId("farm-filter-operator").click();
  await chooseOption(page, "не содержит");
  await page.getByTestId("farm-filter-value").fill("Тестовое");
  const negativeSaved = nextPatch();
  await page.getByTestId("farm-filter-value").press("Tab");
  const [negativeOperation] = (await negativeSaved)
    .request()
    .postDataJSON().operations;
  expect(negativeOperation).toMatchObject({
    node: { field: "name", operator: "not_contains" },
    type: "filter.add",
  });

  await chooseField("Кличка");
  await page.getByTestId("farm-filter-operator").click();
  await chooseOption(page, "в списке");
  await page.getByTestId("farm-filter-value").fill("Ромашка, Зорька");
  const listSaved = nextPatch();
  await page.getByTestId("farm-filter-value").press("Tab");
  const [listOperation] = (await listSaved).request().postDataJSON().operations;
  expect(listOperation).toMatchObject({
    node: {
      field: "name",
      operator: "in",
      value: {
        type: "list",
        values: [
          { type: "string", value: "Ромашка" },
          { type: "string", value: "Зорька" },
        ],
      },
    },
    type: "filter.add",
  });

  await expect(applied.getByTestId("farm-filter-chip")).toHaveCount(4);
  await expect(applied).toContainText("Последний вес между 450 — 650");
  await expect(applied).toContainText("Кличка не содержит Тестовое");
  await expect(applied).toContainText("Кличка в списке Ромашка, Зорька");
  await expect(
    page.getByText("Расширенный фильтр", { exact: true })
  ).toHaveCount(0);
});

test("executes and displays a nested OR filter without an advanced panel", async ({
  page,
}) => {
  await openWorkspace(page);
  const chatId = new URL(page.url()).pathname.split("/").at(-1);
  if (!chatId) {
    throw new Error("Chat id is required");
  }
  const result = await page.evaluate(async (currentChatId) => {
    const currentResponse = await fetch(
      `/api/views?chatId=${encodeURIComponent(currentChatId)}`
    );
    const current = (await currentResponse.json()).view as {
      filters: {
        children: Record<string, unknown>[];
        combinator: "and" | "or";
        id: string;
        kind: "group";
        negated: boolean;
      };
      id: string;
      revision: number;
    };
    const farm = current.filters.children.find(
      (node) => node.field === "farmId"
    );
    if (!farm) {
      throw new Error("Farm filter is required");
    }
    const root = {
      ...current.filters,
      children: [
        farm,
        {
          children: [
            {
              field: "isPregnant",
              id: "41000000-0000-4000-8000-000000000001",
              kind: "condition",
              negated: false,
              operator: "eq",
              value: { type: "boolean", value: true },
            },
            {
              field: "isPregnant",
              id: "41000000-0000-4000-8000-000000000002",
              kind: "condition",
              negated: false,
              operator: "eq",
              value: { type: "boolean", value: false },
            },
          ],
          combinator: "or",
          id: "41000000-0000-4000-8000-000000000003",
          kind: "group",
          negated: false,
        },
      ],
    };
    const response = await fetch(`/api/views/${current.id}`, {
      body: JSON.stringify({
        expectedRevision: current.revision,
        operations: [{ root, type: "filter.replace" }],
      }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    return { payload: await response.json(), status: response.status };
  }, chatId);
  expect(result.status).toBe(200);
  expect(result.payload.view.filters.children[1].combinator).toBe("or");

  await page.reload();
  await page.getByTestId("farm-filtering").click();
  const applied = page.getByTestId("farm-applied-rules");
  await expect(applied.getByTestId("farm-filter-chip")).toHaveCount(3);
  await expect(applied.getByText("ИЛИ", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Расширенный фильтр", { exact: true })
  ).toHaveCount(0);
  await expect(page.getByTestId("farm-row-count")).toHaveText("8500 животных");
});

test("treats farm as an ordinary removable filter", async ({ page }) => {
  await openWorkspace(page);
  const farms = await page.evaluate(async () => {
    const response = await fetch("/api/farms");
    return (
      (await response.json()) as {
        farms: Array<{ id: string; name: string }>;
      }
    ).farms;
  });
  const [, targetFarm] = farms;
  expect(farms.length).toBeGreaterThan(1);
  if (!targetFarm) {
    throw new Error("Second test farm is required");
  }

  await page.getByTestId("farm-filtering").click();
  const applied = page.getByTestId("farm-applied-rules");
  const farmChip = applied
    .getByTestId("farm-filter-chip")
    .filter({ hasText: "Ферма" });
  await expect(farmChip).toHaveCount(1);

  const removed = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      new URL(response.url()).pathname.startsWith("/api/views/")
  );
  const broadenedAnimals = page.waitForResponse((response) => {
    if (
      response.request().method() !== "POST" ||
      !isApiPath(response.url(), animalsPath)
    ) {
      return false;
    }
    const body = response.request().postDataJSON() as {
      cursor?: string | null;
    };
    return !body.cursor;
  });
  await page.getByRole("button", { name: /^Удалить фильтр: Ферма / }).click();
  const removedResponse = await removed;
  const removedPayload = (await removedResponse.json()) as {
    view: { revision: number };
  };
  const [removeOperation] = removedResponse.request().postDataJSON().operations;
  expect(removeOperation).toMatchObject({ type: "filter.remove" });
  await expect(farmChip).toHaveCount(0);
  const broadenedPayload = (await (await broadenedAnimals).json()) as {
    page: { totalRows: number };
    revision: number;
  };
  expect(broadenedPayload.revision).toBe(removedPayload.view.revision);
  expect(broadenedPayload.page.totalRows).toBeGreaterThan(8500);
  await expect(page.getByTestId("farm-row-count")).toHaveText(
    `${broadenedPayload.page.totalRows} животных`
  );

  await applied.getByTestId("farm-add-filter").click();
  await page.getByTestId("farm-filter-field").click();
  await chooseOption(page, "Ферма");
  const added = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      new URL(response.url()).pathname.startsWith("/api/views/")
  );
  await page.getByTestId("farm-filter-value").click();
  await chooseOption(page, targetFarm.name);
  const [addOperation] = (await added).request().postDataJSON().operations;
  expect(addOperation).toMatchObject({
    node: {
      field: "farmId",
      operator: "eq",
      value: { type: "string", value: targetFarm.id },
    },
    type: "filter.add",
  });
  await expect(
    applied.getByTestId("farm-filter-chip").filter({ hasText: targetFarm.name })
  ).toBeVisible();
});

test("groups on the server and expands a group", async ({ page }) => {
  await openWorkspace(page);

  await page.getByTestId("farm-grouping").click();
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      new URL(response.url()).pathname.startsWith("/api/views/")
  );
  await page.getByRole("button", { name: "Добавить группировку" }).click();
  expect((await saved).request().postDataJSON().operations[0]).toMatchObject({
    rule: { field: "sex" },
    type: "group.add",
  });
  await page.keyboard.press("Escape");

  const treegrid = page.getByRole("treegrid");
  await expect(treegrid).toBeVisible();
  const groupToggle = page
    .getByRole("button", { name: /^Развернуть группу Пол:/ })
    .first();
  await expect(groupToggle).toBeVisible();
  const groupRow = treegrid.locator('[data-row-kind="group"]').first();
  await expect(groupRow).toHaveAttribute("data-group-level", "0");
  const groupCell = groupRow.locator(".farm-group-label-cell");
  const groupAppearance = await groupCell.evaluate((cell) => {
    const cellStyle = getComputedStyle(cell);
    const button = cell.querySelector("button");
    if (!button) {
      throw new Error("group toggle is missing");
    }
    const buttonRect = button.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    return {
      buttonBackground: getComputedStyle(button).backgroundColor,
      buttonFitsCell: buttonRect.right <= cellRect.right + 0.5,
      cellOverflow: cellStyle.overflow,
      cellShadow: cellStyle.boxShadow,
    };
  });
  expect(groupAppearance).toEqual({
    buttonBackground: "rgba(0, 0, 0, 0)",
    buttonFitsCell: true,
    cellOverflow: "clip",
    cellShadow: "none",
  });
  const childPage = page.waitForResponse((response) => {
    if (response.request().method() !== "POST") {
      return false;
    }
    if (!isApiPath(response.url(), animalsPath)) {
      return false;
    }
    const body = response.request().postDataJSON();
    return Array.isArray(body.groupPath) && body.groupPath.length === 1;
  });
  await groupToggle.click();
  await childPage;
  await expect(
    page.getByRole("button", { name: /^Свернуть группу Пол:/ }).first()
  ).toHaveAttribute("aria-expanded", "true");
  await expect
    .poll(() =>
      page
        .getByRole("button", { name: /^Свернуть группу Пол:/ })
        .first()
        .evaluate((button) => getComputedStyle(button).backgroundColor)
    )
    .toBe("rgba(0, 0, 0, 0)");
  await expect(
    treegrid.locator('[role="row"][aria-level="2"][data-animal-id]').first()
  ).toBeVisible();
  await expect(page.getByTestId("farm-grouping")).toContainText("1");
});

test("autoloads cursor pages, virtualizes rows and sends exact viewport context", async ({
  page,
}) => {
  const animalRequests: Record<string, unknown>[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && isApiPath(request.url(), animalsPath)) {
      animalRequests.push(request.postDataJSON());
    }
  });
  await openWorkspace(page);
  await expect
    .poll(
      () => animalRequests.filter((request) => request.cursor === null).length
    )
    .toBe(1);

  const grid = page.getByRole("grid");
  const renderedRows = grid.locator("[data-animal-id]");
  const renderedCount = await renderedRows.count();
  expect(renderedCount).toBeGreaterThan(0);
  expect(renderedCount).toBeLessThan(8500);

  const initialRowCount = Number(await grid.getAttribute("aria-rowcount"));
  const nextPageResponse = page.waitForResponse((response) => {
    if (
      response.request().method() !== "POST" ||
      !isApiPath(response.url(), animalsPath)
    ) {
      return false;
    }
    return Boolean(response.request().postDataJSON().cursor);
  });
  await grid.hover();
  await page.mouse.wheel(0, 100_000);
  await expect(page.getByTestId("farm-load-more")).toBeVisible();
  await grid.dispatchEvent("scroll");
  await nextPageResponse;
  await expect
    .poll(() =>
      grid.getAttribute("aria-rowcount").then((value) => Number(value))
    )
    .toBeGreaterThan(initialRowCount);

  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );
  const visibleIds = await grid.evaluate((element) => {
    const bounds = element.parentElement?.getBoundingClientRect();
    if (!bounds) {
      return [];
    }
    return [...element.querySelectorAll<HTMLElement>("[data-animal-id]")]
      .filter((row) => {
        const ownRect = row.getBoundingClientRect();
        const rect =
          ownRect.height > 0
            ? ownRect
            : (row
                .querySelector<HTMLElement>('[role="gridcell"]')
                ?.getBoundingClientRect() ?? ownRect);
        return rect.bottom > bounds.top && rect.top < bounds.bottom;
      })
      .map((row) => row.dataset.animalId)
      .filter((value): value is string => Boolean(value));
  });
  expect(visibleIds.length).toBeGreaterThan(0);

  await page.route("**/api/chat", async (route) => {
    await route.abort();
  });
  const chatRequest = page.waitForRequest((request) =>
    isApiPath(request.url(), "/api/chat")
  );
  await page.getByTestId("multimodal-input").fill("Покажи эти строки");
  await page.getByTestId("send-button").click();
  const viewContext = (await chatRequest).postDataJSON().viewContext as {
    expandedGroupPaths: unknown[];
    selectedIds: string[];
    viewportRowIds: string[];
  };
  expect(viewContext.viewportRowIds).toEqual(visibleIds);
  expect(viewContext.viewportRowIds.length).toBeLessThanOrEqual(200);
  expect(viewContext.expandedGroupPaths).toEqual([]);
  expect(viewContext.selectedIds).toEqual([]);
});

test("rejects a stale view revision", async ({ page }) => {
  const createdView = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      isApiPath(response.url(), "/api/views")
  );
  await openWorkspace(page);
  const created = (await (await createdView).json()) as {
    view: { id: string; revision: number };
  };

  const statuses = await page.evaluate(async (view) => {
    const update = () =>
      fetch(`/api/views/${view.id}`, {
        body: JSON.stringify({
          expectedRevision: view.revision,
          operations: [
            {
              patch: { columns: ["primaryIdentifier", "name"] },
              type: "view.update",
            },
          ],
        }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      });
    const first = await update();
    const stale = await update();
    return [first.status, stale.status];
  }, created.view);

  expect(statuses).toEqual([200, 409]);
});

test("rebases one independent UI change after a stale revision", async ({
  page,
}) => {
  const createdView = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      isApiPath(response.url(), "/api/views")
  );
  await openWorkspace(page);
  const created = (await (await createdView).json()) as {
    view: {
      chatId: string;
      filters: {
        children: Array<{ field?: string; id: string }>;
        id: string;
      };
      id: string;
      revision: number;
    };
  };
  const externalFilterId = "40000000-0000-4000-8000-000000000001";
  const targetFarm = await page.evaluate(async () => {
    const response = await fetch("/api/farms");
    const payload = (await response.json()) as {
      farms: Array<{ id: string; name: string }>;
    };
    const [, farm] = payload.farms;
    if (!farm) {
      throw new Error("Second test farm is required");
    }
    return farm;
  });

  const externalStatus = await page.evaluate(
    async ({ externalFilterId: filterId, view }) => {
      const response = await fetch(`/api/views/${view.id}`, {
        body: JSON.stringify({
          expectedRevision: view.revision,
          operations: [
            {
              index: view.filters.children.length,
              node: {
                field: "statusCode",
                id: filterId,
                kind: "condition",
                negated: false,
                operator: "eq",
                value: { type: "string", value: "LACTATING" },
              },
              parentId: view.filters.id,
              type: "filter.add",
            },
          ],
        }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      });
      return response.status;
    },
    { externalFilterId, view: created.view }
  );
  expect(externalStatus).toBe(200);

  const farmStatuses: number[] = [];
  page.on("response", (response) => {
    if (
      response.request().method() !== "PATCH" ||
      !new URL(response.url()).pathname.startsWith("/api/views/")
    ) {
      return;
    }
    const operations = response.request().postDataJSON().operations as Array<{
      node?: {
        field?: string;
        value?: { type?: string; value?: string };
      };
    }>;
    if (
      operations.some(
        (operation) =>
          operation.node?.field === "farmId" &&
          operation.node.value?.value === targetFarm.id
      )
    ) {
      farmStatuses.push(response.status());
    }
  });

  await page.getByTestId("farm-filtering").click();
  await page
    .getByTestId("farm-filter-chip")
    .filter({ hasText: "Ферма" })
    .click();
  await page.getByTestId("farm-filter-value").click();
  await page.getByRole("option", { name: targetFarm.name }).click();
  await expect.poll(() => farmStatuses).toEqual([409, 200]);
  await expect(
    page.getByTestId("farm-filter-chip").filter({ hasText: targetFarm.name })
  ).toBeVisible();
  await expect(page.getByTestId("farm-applied-rules")).toContainText(
    "Статус равно LACTATING"
  );

  const persisted = await page.evaluate(async (chatId) => {
    const response = await fetch(
      `/api/views?chatId=${encodeURIComponent(chatId)}`
    );
    return response.json();
  }, created.view.chatId);
  expect(persisted.view.schemaVersion).toBe(REPORT_VIEW_SCHEMA_VERSION);
  expect(persisted.view.filters.children).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        field: "farmId",
        value: expect.objectContaining({ value: targetFarm.id }),
      }),
      expect.objectContaining({ id: externalFilterId }),
    ])
  );
});

test("keeps delayed table work scoped to the chat that started it", async ({
  page,
}) => {
  await openWorkspace(page);
  await page.waitForURL(/\/chat\/[0-9a-f-]+$/);
  const firstChatId = new URL(page.url()).pathname.split("/").at(-1);
  if (!firstChatId) {
    throw new Error("First chat id is required");
  }

  const setup = await page.evaluate(async (existingChatId) => {
    const currentViewResponse = await fetch(
      `/api/views?chatId=${encodeURIComponent(existingChatId)}`
    );
    const currentViewPayload = (await currentViewResponse.json()) as {
      view: { id: string };
    };
    const farmsResponse = await fetch("/api/farms");
    const farms = (await farmsResponse.json()) as {
      farms: Array<{ id: string }>;
    };
    const [farm] = farms.farms;
    if (!farm) {
      throw new Error("Test farm is required");
    }
    const chatId = crypto.randomUUID();
    const viewResponse = await fetch("/api/views", {
      body: JSON.stringify({ chatId, farmId: farm.id }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const payload = (await viewResponse.json()) as {
      view: { id: string };
    };
    return {
      chatId,
      firstViewId: currentViewPayload.view.id,
      viewId: payload.view.id,
    };
  }, firstChatId);

  await page.reload();
  await expect(page.getByTestId("farm-workspace")).toBeVisible();
  const sidebarToggle = page.getByRole("button", {
    name: "Открыть боковое меню",
  });
  if (await sidebarToggle.isVisible()) {
    await sidebarToggle.click();
  }
  const firstChatLink = page.locator(`a[href="/chat/${firstChatId}"]`);
  const secondChatLink = page.locator(`a[href="/chat/${setup.chatId}"]`);
  await expect(firstChatLink).toBeVisible();
  await expect(secondChatLink).toBeVisible();

  let releasePatch!: () => void;
  const patchGate = new Promise<void>((resolve) => {
    releasePatch = resolve;
  });
  let patchStarted!: () => void;
  const firstPatchStarted = new Promise<void>((resolve) => {
    patchStarted = resolve;
  });
  let patchDelivered!: () => void;
  const firstPatchDelivered = new Promise<void>((resolve) => {
    patchDelivered = resolve;
  });
  const patchedViewIds: string[] = [];
  let heldFirstPatch = false;
  await page.route("**/api/views/*", async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }
    const viewId = new URL(route.request().url()).pathname.split("/").at(-1);
    if (viewId) {
      patchedViewIds.push(viewId);
    }
    if (viewId !== setup.firstViewId || heldFirstPatch) {
      await route.continue();
      return;
    }
    heldFirstPatch = true;
    const response = await route.fetch();
    patchStarted();
    await patchGate;
    await route.fulfill({ response });
    patchDelivered();
  });

  await page.getByTestId("farm-filtering").click();
  const removeFarm = page.getByRole("button", {
    name: /^Удалить фильтр: Ферма /,
  });
  try {
    await removeFarm.click();
    await firstPatchStarted;
    await secondChatLink.click();
    await page.waitForURL(`/chat/${setup.chatId}`);
    await expect(page.getByTestId("farm-workspace")).toBeVisible();
    await expect(page.getByTestId("farm-workspace")).toHaveAttribute(
      "aria-busy",
      "false"
    );
    expect(patchedViewIds).toEqual([setup.firstViewId]);

    if (!(await page.getByTestId("farm-applied-rules").isVisible())) {
      await page.getByTestId("farm-filtering").click();
    }
    const secondPatch = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        new URL(response.url()).pathname.endsWith(`/${setup.viewId}`)
    );
    await page.getByRole("button", { name: /^Удалить фильтр: Ферма / }).click();
    await secondPatch;
    expect(patchedViewIds).toEqual([setup.firstViewId, setup.viewId]);
    await expect(page.getByTestId("farm-workspace")).toHaveAttribute(
      "aria-busy",
      "false"
    );
  } finally {
    releasePatch();
  }
  await firstPatchDelivered;
  await expect(page.getByTestId("farm-workspace")).toHaveAttribute(
    "aria-busy",
    "false"
  );

  let releaseAnimal!: () => void;
  const animalGate = new Promise<void>((resolve) => {
    releaseAnimal = resolve;
  });
  let animalStarted!: () => void;
  const animalRequestStarted = new Promise<void>((resolve) => {
    animalStarted = resolve;
  });
  let animalDelivered!: () => void;
  const animalRequestDelivered = new Promise<void>((resolve) => {
    animalDelivered = resolve;
  });
  await page.route("**/api/farm/animal", async (route) => {
    const response = await route.fetch();
    animalStarted();
    await animalGate;
    await route.fulfill({ response });
    animalDelivered();
  });

  await firstChatLink.click();
  await page.waitForURL(`/chat/${firstChatId}`);
  await expect(page.getByTestId("animal-number-link").first()).toBeVisible();
  await page.getByTestId("animal-number-link").first().click();
  await animalRequestStarted;
  await secondChatLink.click();
  await page.waitForURL(`/chat/${setup.chatId}`);
  releaseAnimal();
  await animalRequestDelivered;
  await expect(page.getByTestId("animal-card")).toHaveCount(0);
});

test("keeps a late view creation scoped to the chat that started it", async ({
  page,
}) => {
  await openWorkspace(page);
  await page.waitForURL(/\/chat\/[0-9a-f-]+$/);
  const existingChatId = new URL(page.url()).pathname.split("/").at(-1);
  if (!existingChatId) {
    throw new Error("Existing chat id is required");
  }

  const existingView = await page.evaluate(async (chatId) => {
    const response = await fetch(
      `/api/views?chatId=${encodeURIComponent(chatId)}`
    );
    return (await response.json()).view as {
      id: string;
      revision: number;
    };
  }, existingChatId);

  await page.getByTestId("farm-filtering").click();
  const broadenedAnimals = page.waitForResponse((response) => {
    if (
      response.request().method() !== "POST" ||
      !isApiPath(response.url(), animalsPath)
    ) {
      return false;
    }
    const body = response.request().postDataJSON() as {
      cursor?: string | null;
    };
    return !body.cursor;
  });
  await page.getByRole("button", { name: /^Удалить фильтр: Ферма / }).click();
  const broadenedPayload = (await (await broadenedAnimals).json()) as {
    page: { totalRows: number };
  };
  await expect(page.getByTestId("farm-row-count")).toHaveText(
    `${broadenedPayload.page.totalRows} животных`
  );

  const sidebarToggle = page.getByRole("button", {
    name: "Открыть боковое меню",
  });
  if (await sidebarToggle.isVisible()) {
    await sidebarToggle.click();
  }
  const existingChatLink = page.locator(`a[href="/chat/${existingChatId}"]`);
  await expect(existingChatLink).toBeVisible();

  let releaseCreation!: () => void;
  const creationGate = new Promise<void>((resolve) => {
    releaseCreation = resolve;
  });
  let creationStarted!: (chatId: string) => void;
  const lateCreationStarted = new Promise<string>((resolve) => {
    creationStarted = resolve;
  });
  let creationDelivered!: () => void;
  const lateCreationDelivered = new Promise<void>((resolve) => {
    creationDelivered = resolve;
  });
  let holdNextCreation = true;
  await page.route("**/api/views", async (route) => {
    if (route.request().method() !== "POST" || !holdNextCreation) {
      await route.continue();
      return;
    }
    holdNextCreation = false;
    const input = route.request().postDataJSON() as { chatId: string };
    const response = await route.fetch();
    creationStarted(input.chatId);
    await creationGate;
    await route.fulfill({ response });
    creationDelivered();
  });

  let creationReleased = false;
  const releaseLateCreation = () => {
    if (!creationReleased) {
      creationReleased = true;
      releaseCreation();
    }
  };
  try {
    await page.getByRole("button", { exact: true, name: "Новый чат" }).click();
    const creatingChatId = await lateCreationStarted;
    expect(creatingChatId).not.toBe(existingChatId);

    await existingChatLink.click();
    await page.waitForURL(`/chat/${existingChatId}`);
    await expect(page.getByTestId("farm-workspace")).toBeVisible();
    await expect(page.getByTestId("farm-workspace")).toHaveAttribute(
      "aria-busy",
      "false"
    );
    await expect(page.getByTestId("farm-row-count")).toHaveText(
      `${broadenedPayload.page.totalRows} животных`
    );
    const appliedRules = page.getByTestId("farm-applied-rules");
    if (!(await appliedRules.isVisible())) {
      await page.getByTestId("farm-filtering").click();
    }
    const farmChip = appliedRules
      .getByTestId("farm-filter-chip")
      .filter({ hasText: "Ферма" });
    await expect(farmChip).toHaveCount(0);

    const historyRefreshed = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        isApiPath(response.url(), "/api/history")
    );
    releaseLateCreation();
    await lateCreationDelivered;
    await historyRefreshed;
    await expect(
      page.locator(`a[href="/chat/${creatingChatId}"]`)
    ).toBeVisible();
    await expect(page).toHaveURL(`/chat/${existingChatId}`);
    await expect(page.getByTestId("farm-row-count")).toHaveText(
      `${broadenedPayload.page.totalRows} животных`
    );
    await expect(farmChip).toHaveCount(0);

    await appliedRules.getByTestId("farm-add-filter").click();
    await page.getByTestId("farm-filter-field").click();
    await chooseOption(page, "Статус");
    const bMutation = page.waitForRequest(
      (request) =>
        request.method() === "PATCH" &&
        new URL(request.url()).pathname.startsWith("/api/views/")
    );
    await page.getByTestId("farm-filter-value").click();
    await chooseOption(page, "LACTATING");
    expect(new URL((await bMutation).url()).pathname).toBe(
      `/api/views/${existingView.id}`
    );
  } finally {
    releaseLateCreation();
  }

  const persisted = await page.evaluate(async (chatId) => {
    const response = await fetch(
      `/api/views?chatId=${encodeURIComponent(chatId)}`
    );
    return (await response.json()).view as {
      filters: { children: Array<{ field?: string }> };
      id: string;
      revision: number;
    };
  }, existingChatId);
  expect(persisted.id).toBe(existingView.id);
  expect(persisted.revision).toBeGreaterThan(existingView.revision);
  expect(persisted.filters.children).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ field: "farmId" })])
  );
});
