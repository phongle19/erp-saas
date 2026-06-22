import { test, expect } from "@playwright/test";

test("vi-first routing: /vi/login returns HTTP 200 and renders Vietnamese login label", async ({
  page,
}) => {
  const response = await page.goto("/vi/login");
  // The locale route must be served (not 404) by the production server.
  expect(response, "page.goto returned no response").not.toBeNull();
  expect(response!.status()).toBe(200);
  // And it should show the Vietnamese label "Đăng nhập" (from auth.login)
  await expect(page.getByRole("heading", { name: "Đăng nhập" })).toBeVisible({
    timeout: 15_000,
  });
});

test("/ redirects to /vi by default", async ({ page }) => {
  const response = await page.goto("/", { waitUntil: "networkidle" });
  expect(response, "page.goto returned no response").not.toBeNull();
  // After following the locale redirect we should land on /vi with a 200.
  expect(response!.status()).toBe(200);
  expect(page.url()).toContain("/vi");
});

// Reports route: the server-component fetch fails gracefully when API is offline
// so the page still renders its Vietnamese heading and "no data" empty-state.
test("reports index: /vi/companies/test-id/reports renders Vietnamese heading", async ({
  page,
}) => {
  const response = await page.goto("/vi/companies/test-id/reports");
  expect(response, "page.goto returned no response").not.toBeNull();
  // The route must be served (not 404) — graceful empty state when API is down.
  expect(response!.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Báo cáo" })).toBeVisible({
    timeout: 15_000,
  });
});

test("reports trial-balance: /vi/companies/test-id/reports/trial-balance renders heading and no-data", async ({
  page,
}) => {
  const response = await page.goto(
    "/vi/companies/test-id/reports/trial-balance?fiscalYear=2025&through=12"
  );
  expect(response, "page.goto returned no response").not.toBeNull();
  expect(response!.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Bảng cân đối thử" })
  ).toBeVisible({ timeout: 15_000 });
  // When API is offline rows are empty → "Không có dữ liệu" appears
  await expect(page.getByText("Không có dữ liệu")).toBeVisible({
    timeout: 15_000,
  });
});

test("reports balance-sheet: /vi/companies/test-id/reports/balance-sheet renders heading", async ({
  page,
}) => {
  const response = await page.goto(
    "/vi/companies/test-id/reports/balance-sheet?fiscalYear=2025&through=12"
  );
  expect(response, "page.goto returned no response").not.toBeNull();
  expect(response!.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: /Báo cáo tình hình tài chính/ })
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Không có dữ liệu")).toBeVisible({
    timeout: 15_000,
  });
});

test("reports income-statement: /vi/companies/test-id/reports/income-statement renders heading", async ({
  page,
}) => {
  const response = await page.goto(
    "/vi/companies/test-id/reports/income-statement?fiscalYear=2025&through=12"
  );
  expect(response, "page.goto returned no response").not.toBeNull();
  expect(response!.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: /Báo cáo kết quả kinh doanh/ })
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Không có dữ liệu")).toBeVisible({
    timeout: 15_000,
  });
});
