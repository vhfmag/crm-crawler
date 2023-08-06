import { Page } from "puppeteer-core";

export async function extractPageData(page: Page) {
  const itemSelector = ".resultado-item";
  await page.waitForSelector(itemSelector);
  console.log("Items loaded, waiting for aditional info to load");

  await Promise.all([
    page.waitForSelector(".row.endereco", { visible: true }),
    page.waitForSelector(".row.telefone", { visible: true }),
  ]);
  await page.waitForNetworkIdle();
  console.log("Additional info loaded, extracting data");

  return page.evaluate((selector) => {
    return [...document.querySelectorAll(selector)].map((item) => {
      const staticEntries = [
        ["Nome", item.querySelector("h4")!.textContent!.trim()],
      ];
      return Object.fromEntries(
        staticEntries.concat(
          [...item.querySelectorAll("b")].map((b) => {
            const [key, value] = [...b.parentElement!.childNodes]
              .map((node) => node.textContent?.trim())
              .filter(Boolean);
            return [key!.replace(/:$/, ""), value!];
          })
        )
      );
    });
  }, itemSelector);
}
