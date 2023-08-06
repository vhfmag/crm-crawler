import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import RecaptchaPlugin from "puppeteer-extra-plugin-recaptcha";
import fs from "node:fs/promises";
import Papa from "papaparse";
import ms, { StringValue as MsString } from "ms";
import { detectAndHandleRecaptchas } from "./utils/recaptcha";
import { patchConsole } from "./utils/log";
import { getBrowserExecutable } from "./utils/browser";
import { goToNextPage } from "./utils/navigation";
import { extractPageData } from "./utils/extraction";
import { createDirIfMissing, writeOutput } from "./utils/output";

puppeteer.use(StealthPlugin());
puppeteer.use(RecaptchaPlugin({ visualFeedback: true }));

const idList = new Set<string>();
const idMap = new Map<string, Record<string, string>>();
const skippedPages: number[] = [];

process.on("unhandledRejection", (reason, promise) => {
  console.warn("Unhandled Rejection at:", promise, "reason:", reason);
});

const DEFAULT_TIMEOUT: MsString = "2 min";

async function main() {
  const browser = await puppeteer.launch({
    executablePath: await getBrowserExecutable(),
    headless: false,
    devtools: true,
    args: ["--start-maximized"],
  });

  const incognito = await browser.createIncognitoBrowserContext();

  const page = await incognito.newPage();
  page.on("close", () => browser.close());

  patchConsole(new WeakRef(page));
  detectAndHandleRecaptchas(page);

  page.setDefaultTimeout(ms(DEFAULT_TIMEOUT));

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
          const form = document.querySelector("form#buscaForm");
          (form?.closest("article") ?? form)?.scrollIntoView();
          setTimeout(() => alert("Escolha seus filtros e clique em buscar"), 0);
        }),
      searchButtonSelector
    );
    page.setDefaultTimeout(ms(DEFAULT_TIMEOUT));
  }

  const lastPageButtonSelector = ".paginationjs-page.paginationjs-last";
  await page.waitForSelector(lastPageButtonSelector);
  const totalPages = await page.evaluate(
    (selector) => document.querySelector(selector)?.textContent,
    lastPageButtonSelector
  );
  console.log(`Initiating extraction script. Total pages: ${totalPages}`);

  let pageNumber: number | undefined = 1;
  console.group(`Page ${pageNumber}/${totalPages}`);
  do {
    const dedupedItemCountBefore = idList.size;
    try {
      const pageData = await extractPageData(page);

      for (const item of pageData) {
        const id = item["CRM"]!;
        if (!idList.has(id)) {
          idList.add(id);
          idMap.set(id, { ...item, Página: String(pageNumber) });
        }
      }

      if (idList.size === dedupedItemCountBefore) {
        skippedPages.push(pageNumber);
      }

      const timerLabel = "Report & write partial results";
      console.time(timerLabel);
      console.log("Partial results", {
        pageNumber,
        total: idList.size,
        lastItem: idMap.get([...idList].slice(-1)[0]),
        skippedPages,
      });

      const data = [...idMap.values()];
      await createDirIfMissing("output");
      await Promise.all([
        writeOutput("output/data.json", JSON.stringify({ data, skippedPages })),
        writeOutput("output/data.csv", Papa.unparse(data)),
      ]);
      console.timeEnd(timerLabel);
    } finally {
    }
  } while (
    await goToNextPage(page, (n) => {
      pageNumber = n;
      console.groupEnd();
      console.group(`Page ${pageNumber}/${totalPages}`);
    })
  );

  await browser.close();
}

main();
