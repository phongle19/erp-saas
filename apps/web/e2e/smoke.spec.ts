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
