import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import readline from "node:readline/promises";
import fs from "node:fs/promises";
import { Page } from "puppeteer";
import Papa from "papaparse";
import ms, { StringValue as MsString } from "ms";

puppeteer.use(StealthPlugin());

const idList = new Set<string>();
const idMap = new Map<string, Record<string, string>>();
const duplicateCountMap = new Map<string, number>();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

process.on("unhandledRejection", (reason, promise) => {
  console.warn("Unhandled Rejection at:", promise, "reason:", reason);
});

const goToNextPage = async (
  page: Page,
  onNewPage?: (num: string | undefined) => void
) => {
  const [hasNextPage, pageNumber] = await page.evaluate(() => {
    for (const currentResult of document.querySelectorAll(".resultado-item")) {
      currentResult.classList.add("stale");
    }

    const nextPageTrigger = document.querySelector(
      ".paginationjs-page.active + .paginationjs-page a"
    );
    const hasNextPage = nextPageTrigger instanceof HTMLElement;
    const pageNumber = hasNextPage
      ? nextPageTrigger.parentElement!.dataset.num
      : undefined;
    console.log(`Is there a next page? ${hasNextPage}`);
    if (hasNextPage) {
      console.log("Next page load: triggering", {
        num: nextPageTrigger.parentElement!.dataset.num,
      });
      nextPageTrigger.click();
      console.log("Next page load: triggered", {
        num: nextPageTrigger.parentElement!.dataset.num,
      });
    }
    return [hasNextPage, pageNumber] as const;
  });
  if (hasNextPage) {
    await page.waitForSelector(".resultado-item:not(.stale)");
    console.log("Next page load: done");
  }
  onNewPage?.(pageNumber);
  return hasNextPage;
};

const pauseNode = () => rl.question("Press enter to continue");
const pauseBrowser = (page: Page) =>
  page.evaluate(() => {
    debugger;
  });

const takeScreenshot = (page: Page) =>
  page.screenshot({ path: "output/screenshot.png" });

let abortController: AbortController | null = null;

const DEFAULT_TIMEOUT: MsString = "2 min";

async function main() {
  const browser = await puppeteer.launch({ headless: false, devtools: true });
  browser.on("disconnected", () => rl.close());

  const incognito = await browser.createIncognitoBrowserContext();

  const page = await incognito.newPage();
  page.on("frameattached", async (frame) => {
    if (frame.url().includes("recaptcha/")) {
      console.log("recaptcha detectado");
      await Promise.all([
        page.bringToFront(),
        page.evaluate(() =>
          document.querySelector(`iframe[src*="recaptcha/"]`)?.scrollIntoView()
        ),
        page.evaluate(() => alert("Resolva o recaptcha")),
      ]);
    }
  });

  page.setDefaultTimeout(ms(DEFAULT_TIMEOUT));

  await page.setViewport({ width: 1080, height: 1024 });
  await page.goto("https://portal.cfm.org.br/busca-medicos/");

  {
    const searchButtonSelector = ".site-content form button[type=submit]";
    await page.waitForSelector(searchButtonSelector);
    page.setDefaultTimeout(ms("1h"));
    await page.evaluate(
      (searchButtonSelector) =>
        new Promise<void>((resolve, reject) => {
          const searchButton = document.querySelector(searchButtonSelector);
          if (!(searchButton instanceof HTMLButtonElement)) {
            throw reject(new Error("Search button not found"));
          }
          searchButton.addEventListener("click", () => resolve(), {
            once: true,
          });
          alert("Escolha seus filtros e clique em buscar");
        }),
      searchButtonSelector
    );
    page.setDefaultTimeout(ms(DEFAULT_TIMEOUT));
  }

  let pageNumber: string | undefined = "1";
  do {
    const itemSelector = ".resultado-item";
    await page.waitForSelector(itemSelector);
    console.log("Items loaded, waiting for aditional info to load");
    await page.waitForSelector(".row.endereco", { visible: true });
    await page.waitForNetworkIdle();
    console.log("Additional info loaded, extracting data");
    const pageData = await page.evaluate((selector) => {
      return [...document.querySelectorAll(selector)].map((item) => {
        type Entry = [keyof any, unknown];
        const staticEntries = [
          ["Nome", item.querySelector("h4")!.textContent!.trim()],
        ] satisfies Entry[];
        return Object.fromEntries(
          staticEntries.concat(
            [...item.querySelectorAll("b")].map((b) => {
              const [key, value] = [...b.parentElement!.childNodes]
                .map((node) => node.textContent?.trim())
                .filter(Boolean);
              return [key!.replace(/:$/, ""), value!] satisfies Entry;
            })
          )
        );
      });
    }, itemSelector);

    for (const item of pageData) {
      const id = item["CRM"]!;
      if (!idList.has(id)) {
        idList.add(id);
        idMap.set(id, { ...item, Página: pageNumber });
      } else {
        const count = duplicateCountMap.get(id) ?? 0;
        duplicateCountMap.set(id, count + 1);
      }
    }

    abortController?.abort();
    abortController = new AbortController();

    const { signal } = abortController;
    const timerHandle = setImmediate(async () => {
      console.log("setImmediate called");
      console.log("Partial results", {
        pageNumber,
        total: idList.size,
        lastItem: idMap.get([...idList].slice(-1)[0]),
        totalDuplicates: [...duplicateCountMap].reduce(
          (acc, [_, v]) => acc + v,
          0
        ),
        duplicatesPerId: Object.fromEntries(
          [...duplicateCountMap].sort((a, b) => b[1] - a[1])
        ),
      });

      const data = [...idMap.values()];
      await Promise.all([
        fs.writeFile("output/data.json", JSON.stringify(data), {
          signal,
        }),
        fs.writeFile(
          "output/duplicates.json",
          JSON.stringify([...duplicateCountMap.values()]),
          { signal }
        ),
        fs.writeFile("output/data.csv", Papa.unparse(data), { signal }),
      ]);
    });
    signal.addEventListener("abort", () => clearImmediate(timerHandle));
  } while (
    await goToNextPage(page, (n) => {
      pageNumber = n;
    })
  );

  await browser.close();
}

main();
