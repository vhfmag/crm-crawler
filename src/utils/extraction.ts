import { Page } from "puppeteer-core";

const itemSelector = ".resultado-item";

export async function waitDataLoad(page: Page) {
  await page.waitForSelector(itemSelector);
  console.log("Items loaded, waiting for aditional info to load");

  await Promise.all([
    page.waitForSelector(".row.endereco", { visible: true }),
    page.waitForSelector(".row.telefone", { visible: true }),
  ]);
  await page.waitForNetworkIdle();
  console.log("Additional info loaded, extracting data");
}

export async function extractPageData(page: Page) {
  await waitDataLoad(page);
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
          }),
          [
            ...item.querySelectorAll(
              ".row:has(div:only-child > b:only-child) + .row > div:only-child:not(:has(b))"
            ),
          ]
            .map((el) => {
              if (!(el instanceof HTMLElement)) return undefined;

              const value = el.innerText.trim();

              const keyEl = el.parentElement?.previousElementSibling;

              if (!(keyEl instanceof HTMLElement)) return undefined;

              return [keyEl.innerText.trim().replace(/:$/, ""), value];
            })
            .filter(
              <T>(v: T): v is NonNullable<T> => v !== null && v !== undefined
            )
        )
      );
    });
  }, itemSelector);
}
