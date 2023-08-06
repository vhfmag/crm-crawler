import { Page } from "puppeteer-core";

export const pauseBrowser = (page: Page) =>
  page.evaluate(() => {
    debugger;
  });

export const takeScreenshot = (page: Page) =>
  page.screenshot({ path: "output/screenshot.png" });
