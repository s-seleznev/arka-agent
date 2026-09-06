// biome-ignore-all lint/performance/noAwaitInLoops: Browser mutations must finish before the next rule is added.
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  MAX_FILTER_CONDITIONS,
  REPORT_VIEW_SCHEMA_VERSION,
} from "../../lib/farm/types";

test.use({ viewport: { height: 900, width: 1440 } });

const animalsPath = "/api/farm/animals";

async function openWorkspace(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("farm-workspace")).toBeVisible();
  await expect(page.getByTestId("farm-row-count")).toHaveText("8500 животных");
}

async function patchFrom(
  page: Page,
  action: () => Promise<void>
): Promise<Record<string, unknown>> {
  const responsePromise = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === "PATCH" &&
      new URL(candidate.url()).pathname.startsWith("/api/views/")
  );
  await action();
  const patchResponse = await responsePromise;
  expect(patchResponse.ok()).toBe(true);
  return patchResponse.request().postDataJSON() as Record<string, unknown>;
}

function ruleLabels(popover: Locator) {
  return popover
    .getByLabel(/^\u041fоле правила \d+$/)
    .evaluateAll((triggers) =>
      triggers.map((trigger) => trigger.textContent?.trim() ?? "")
    );
}

test("ограничивает сортировку пятью правилами и меняет их приоритет", async ({
  page,
}) => {
  await openWorkspace(page);
  await page.getByTestId("farm-sorting").click();

  const popover = page.locator("#farm-sort-popover");
  const add = popover.getByRole("button", {
    exact: true,
    name: "Добавить сортировку",
  });
  for (let index = 0; index < 5; index += 1) {
    const payload = await patchFrom(page, () => add.click());
    expect(payload.operations).toMatchObject([{ index, type: "sort.add" }]);
    await expect(popover.getByLabel(`Поле правила ${index + 1}`)).toBeVisible();
  }

  await expect(add).toBeDisabled();
  await expect(popover.getByLabel(/^Поле правила \d+$/)).toHaveCount(5);
  const before = await ruleLabels(popover);

  const moved = await patchFrom(page, () =>
    popover.getByLabel("Правило 5: выше").click()
  );
  expect(moved.operations).toMatchObject([{ index: 3, type: "sort.move" }]);
  await expect
    .poll(() => ruleLabels(popover))
    .toEqual([before[0], before[1], before[2], before[4], before[3]]);
});

test("ограничивает группировку одним полем", async ({ page }) => {
  await openWorkspace(page);
  await page.getByTestId("farm-grouping").click();

  const popover = page.locator("#farm-group-popover");
  const add = popover.getByRole("button", {
    exact: true,
    name: "Добавить группировку",
  });
  const payload = await patchFrom(page, () => add.click());
  expect(payload.operations).toMatchObject([{ index: 0, type: "group.add" }]);
  await expect(popover.getByLabel("Поле группировки")).toBeVisible();
  await expect(add).toHaveCount(0);
  await expect(popover.getByLabel(/Перетащить правило/)).toHaveCount(0);
  await expect(popover.getByLabel(/Правило \d+: (выше|ниже)/)).toHaveCount(0);
});

test("ограничивает дерево текущим пределом условий", async ({ page }) => {
  const createdView = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/views"
  );
  await openWorkspace(page);
  const created = (await (await createdView).json()) as {
    view: {
      filters: { children: unknown[]; id: string };
      id: string;
      revision: number;
      schemaVersion: number;
    };
  };
  expect(created.view.schemaVersion).toBe(REPORT_VIEW_SCHEMA_VERSION);

  const status = await page.evaluate(
    async ({ view, maxConditions }) => {
      const nodes = Array.from(
        { length: maxConditions - view.filters.children.length },
        (_, index) => ({
          node: {
            field: "name",
            id: `50000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
            kind: "condition",
            negated: false,
            operator: "neq",
            value: { type: "string", value: `Исключение ${index + 1}` },
          },
        })
      ).map((item) => item.node);
      const response = await fetch(`/api/views/${view.id}`, {
        body: JSON.stringify({
          expectedRevision: view.revision,
          patch: {
            filters: {
              ...view.filters,
              children: [...view.filters.children, ...nodes],
            },
          },
        }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      });
      return response.status;
    },
    { maxConditions: MAX_FILTER_CONDITIONS, view: created.view }
  );
  expect(status).toBe(200);

  await page.reload();
  await page.getByTestId("farm-filtering").click();
  const applied = page.getByTestId("farm-applied-rules");
  await expect(applied.getByTestId("farm-filter-chip")).toHaveCount(
    MAX_FILTER_CONDITIONS
  );
  await expect(applied.getByTestId("farm-add-filter")).toBeDisabled();
  await expect(
    page.getByText("Расширенный фильтр", { exact: true })
  ).toHaveCount(0);
});

test("сохраняет строки при ошибке страницы, повторяет тот же cursor и останавливается на end", async ({
  page,
}) => {
  type AnimalsPayload = {
    page: {
      end: boolean;
      groups: unknown[];
      kind: "groups" | "rows";
      nextCursor: string | null;
      rows: Array<{ primaryIdentifier?: unknown }>;
      snapshot: number;
      totalGroups: number;
      totalRows: number;
    };
    revision: number;
  };

  let initialPayload: AnimalsPayload | null = null;
  const nextCursors: string[] = [];
  await page.route(`**${animalsPath}`, async (route) => {
    const body = route.request().postDataJSON() as { cursor?: string | null };
    if (!body.cursor) {
      const upstream = await route.fetch();
      const payload = (await upstream.json()) as AnimalsPayload;
      initialPayload ??= payload;
      await route.fulfill({
        body: JSON.stringify(payload),
        contentType: "application/json",
        response: upstream,
      });
      return;
    }

    nextCursors.push(body.cursor);
    if (nextCursors.length === 1) {
      await route.fulfill({
        body: JSON.stringify({
          cause: "Synthetic next-page failure",
          code: "bad_request:api",
        }),
        contentType: "application/json",
        status: 503,
      });
      return;
    }

    if (!initialPayload) {
      throw new Error("Initial animal page was not captured");
    }
    await route.fulfill({
      body: JSON.stringify({
        page: {
          ...initialPayload.page,
          end: true,
          groups: [],
          nextCursor: null,
          rows: [],
        },
        revision: initialPayload.revision,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await openWorkspace(page);
  if (!initialPayload) {
    throw new Error("Initial animal page was not captured");
  }
  const capturedPayload: AnimalsPayload = initialPayload;
  expect(capturedPayload.page.kind).toBe("rows");
  const grid = page.getByRole("grid");
  const initialAriaRowCount = await grid.getAttribute("aria-rowcount");
  const loadMore = page.getByTestId("farm-load-more");
  const retry = page.getByTestId("farm-page-retry");

  await grid.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await expect(loadMore.or(retry)).toBeVisible();
  if (await loadMore.isVisible()) {
    await loadMore.click();
  }
  await expect(retry).toBeVisible();
  await expect(grid).toHaveAttribute(
    "aria-rowcount",
    initialAriaRowCount ?? ""
  );
  expect(nextCursors).toHaveLength(1);

  await retry.click();
  await expect(retry).toHaveCount(0);
  await expect(loadMore).toHaveCount(0);
  await expect(
    page.getByText("Загружаем продолжение…", { exact: true })
  ).toHaveCount(0);
  expect(nextCursors).toHaveLength(2);
  expect(nextCursors[1]).toBe(nextCursors[0]);

  const firstIdentifier = String(
    capturedPayload.page.rows[0]?.primaryIdentifier ?? ""
  );
  expect(firstIdentifier).not.toBe("");
  await grid.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await expect(
    page.getByRole("button", {
      exact: true,
      name: `Открыть карточку животного ${firstIdentifier}`,
    })
  ).toBeVisible();

  await grid.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await page.waitForTimeout(300);
  expect(nextCursors).toHaveLength(2);
});
