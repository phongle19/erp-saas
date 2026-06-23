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

// Sales routes: server-component fetches fail gracefully when API is offline
// so the pages still render their Vietnamese headings and "no data" empty-states.
test("sales customers: /vi/companies/test-id/sales/customers renders heading and no-data", async ({
  page,
}) => {
  const response = await page.goto("/vi/companies/test-id/sales/customers");
  expect(response, "page.goto returned no response").not.toBeNull();
  expect(response!.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Khách hàng", exact: true })
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Không có dữ liệu")).toBeVisible({
    timeout: 15_000,
  });
});

test("sales ar: /vi/companies/test-id/sales/ar renders heading and no-data", async ({
  page,
}) => {
  const response = await page.goto(
    "/vi/companies/test-id/sales/ar?fiscalYear=2025&through=12"
  );
  expect(response, "page.goto returned no response").not.toBeNull();
  expect(response!.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Công nợ phải thu" })
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Không có dữ liệu")).toBeVisible({
    timeout: 15_000,
  });
});

// Sales invoices route: server-component fetches for partners/periods fail
// gracefully when API is offline — empty-guard state shows without a live backend.
test("sales invoices: /vi/companies/test-id/sales/invoices renders heading and empty-guard", async ({
  page,
}) => {
  const response = await page.goto("/vi/companies/test-id/sales/invoices");
  expect(response, "page.goto returned no response").not.toBeNull();
  // The route must be served (not 404).
  expect(response!.status()).toBe(200);
  // The page heading "Hóa đơn bán hàng" is always rendered regardless of API state.
  await expect(
    page.getByRole("heading", { name: "Hóa đơn bán hàng" })
  ).toBeVisible({ timeout: 15_000 });
  // When API is offline both partners and periods fetch return [] →
  // InvoiceForm renders the empty-guard warning instead of the form.
  await expect(
    page.getByText("Vui lòng tạo trước khi lập hóa đơn.")
  ).toBeVisible({ timeout: 15_000 });
});
