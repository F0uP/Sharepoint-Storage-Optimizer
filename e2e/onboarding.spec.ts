import { expect, test } from "@playwright/test";

test("first start shows the welcome tour, then a guided tour of the workspace", async ({ page }) => {
  await page.goto("/");
  const welcome = page.getByRole("dialog");
  await expect(welcome.getByRole("heading", { name: "Mehr Platz in SharePoint" })).toBeVisible({ timeout: 30_000 });
  await welcome.getByRole("button", { name: "Weiter" }).click();
  await expect(welcome.getByRole("heading", { name: "In drei Schritten" })).toBeVisible();
  await welcome.getByRole("button", { name: "Weiter" }).click();
  await expect(welcome.getByRole("heading", { name: "Sicher und umkehrbar" })).toBeVisible();
  await welcome.getByRole("button", { name: "Demo ansehen" }).click();

  await page.getByText("Marketing & Kommunikation").click();
  const popover = page.locator(".driver-popover");
  await expect(popover.getByText("Dein Einsparpotenzial")).toBeVisible({ timeout: 30_000 });
  await expect(popover.getByText("1 von 7")).toBeVisible();
  for (let i = 0; i < 6; i++) await popover.getByRole("button", { name: "Weiter" }).click();
  await expect(popover.getByText("Bericht", { exact: true })).toBeVisible();
  await popover.getByRole("button", { name: "Los geht's" }).click();
  await expect(popover).toHaveCount(0);

  // seen once – a reload does not show it again, but it can be restarted
  await page.reload();
  await expect(page.getByRole("heading", { name: /Mehr Platz in SharePoint – in Minuten/ })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Demo ansehen" }).click();
  await page.getByText("Marketing & Kommunikation").click();
  await expect(page.getByRole("heading", { name: "Übersicht" })).toBeVisible({ timeout: 30_000 });
  await expect(popover).toHaveCount(0);
  await page.keyboard.press("Control+k");
  await page.getByRole("dialog").getByRole("combobox").fill("Einstiegstour");
  await page.getByRole("dialog").getByRole("option", { name: "Einstiegstour starten" }).click();
  await expect(popover.getByText("Dein Einsparpotenzial")).toBeVisible();
});
