import { Page } from "puppeteer-core";
import { isNotNullish } from "./helpers";

export const goToPage = async (page: Page, pageNumber: number) => {
  const succeeded = await page.evaluate((pageNumber) => {
    for (const currentResult of document.querySelectorAll(".resultado-item")) {
      currentResult.classList.add("stale");
    }

    const nextPageTrigger = document.querySelector(
      `.paginationjs-page[data-num='${pageNumber}'] a[href]`
    );

    if (!(nextPageTrigger instanceof HTMLElement)) return false;

    console.log("Page load: triggering", { pageNumber });
    nextPageTrigger.click();
    console.log("Page load: triggered", { pageNumber });
    return true;
  }, pageNumber);

  if (succeeded) {
    await page.waitForSelector(".resultado-item:not(.stale)");
    console.log("Page load: done", { pageNumber });
  }

  return succeeded;
};

export const goToNextPage = async (
  page: Page,
  onNewPage?: (pageNumber: number | undefined) => void
) => {
  const pageNumber = await page.evaluate(() => {
    const nextPageTrigger = document.querySelector(
      ".paginationjs-page.active + .paginationjs-page[data-num] a[href]"
    );
    const pageNumberStr =
      nextPageTrigger instanceof HTMLElement
        ? nextPageTrigger.parentElement!.dataset.num
        : undefined;

    const pageNumber = parseInt(pageNumberStr ?? "", 10);
    return isNaN(pageNumber) ? undefined : pageNumber;
  });

  if (isNotNullish(pageNumber)) {
    const succeeded = await goToPage(page, pageNumber);
    if (succeeded) onNewPage?.(pageNumber);
    return succeeded;
  }

  return false;
};
