import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import readline from "node:readline/promises";
import { Page } from "puppeteer";

puppeteer.use(StealthPlugin());

const idList = new Set<string>();
const idMap = new Map<string, Record<string, string>>();
const duplicateCountMap = new Map<string, number>();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const goToNextPage = async (page: Page) => {
  const hasNextPage = await page.evaluate(() => {
    for (const currentResult of document.querySelectorAll(".resultado-item")) {
      currentResult.classList.add("stale");
    }

    const nextPageTrigger = document.querySelector(
      ".paginationjs-page.active + .paginationjs-page a"
    );
    const hasNextPage = nextPageTrigger instanceof HTMLElement;
    if (hasNextPage) {
      nextPageTrigger.click();
      console.log("next page triggered", {
        num: nextPageTrigger.parentElement!.dataset.num,
      });
    }
    return hasNextPage;
  });
  if (hasNextPage) {
    await page.waitForSelector(".resultado-item:not(.stale)");
    console.log("next page loaded");
  }
  return hasNextPage;
};

const pauseNode = () => rl.question("Press enter to continue");
const pauseBrowser = (page: Page) =>
  page.evaluate(() => {
    debugger;
  });

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
      ]);
    }
  });

  await page.setViewport({ width: 1080, height: 1024 });
  await page.goto("https://portal.cfm.org.br/busca-medicos/");

  {
    const searchButtonSelector = ".site-content form button[type=submit]";
    await page.waitForSelector(searchButtonSelector);
    await page.click(searchButtonSelector);
  }

  do {
    const itemSelector = ".resultado-item";
    await page.waitForSelector(itemSelector);
    await page.waitForSelector(".row.endereco", { visible: true });
    await page.waitForNetworkIdle();
    const pageData = await page.evaluate((selector) => {
      return [...document.querySelectorAll(selector)].map((item) => {
        return Object.fromEntries(
          [...item.querySelectorAll("b")]
            .map((b) => {
              const [key, value] = [...b.parentElement!.childNodes]
                .map((node) => node.textContent?.trim())
                .filter(Boolean);
              return [key!.replaceAll(":", ""), value!] as const;
            })
            .concat([["Nome", item.querySelector("h4")!.textContent!.trim()]])
        );
      });
    }, itemSelector);

    for (const item of pageData) {
      const id = item["CRM"]!;
      if (!idList.has(id)) {
        idList.add(id);
        idMap.set(id, item);
      } else {
        const count = duplicateCountMap.get(id) ?? 0;
        duplicateCountMap.set(id, count + 1);
      }
    }

    console.log("partial results", {
      total: idList.size,
      last10: [...idList].slice(-10).map((id) => idMap.get(id)),
      totalDuplicates: [...duplicateCountMap].reduce(
        (acc, [_, v]) => acc + v,
        0
      ),
      duplicatesPerId: Object.fromEntries(
        [...duplicateCountMap].sort((a, b) => b[1] - a[1])
      ),
    });
  } while (await goToNextPage(page));

  // await pauseNode();
  await page.screenshot({ path: "screenshot.png" });

  await browser.close();
}

main();
