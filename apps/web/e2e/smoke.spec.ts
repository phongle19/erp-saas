import { test, expect } from "@playwright/test";

test("vi-first routing: /vi/login renders Vietnamese login label", async ({
  page,
}) => {
  await page.goto("/vi/login");
  // The page should show the Vietnamese label "Đăng nhập" (from auth.login)
  await expect(page.getByRole("heading", { name: "Đăng nhập" })).toBeVisible({
    timeout: 15_000,
  });
});

test("/ redirects to /vi by default", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  expect(page.url()).toContain("/vi");
});
