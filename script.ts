import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import RecaptchaPlugin from "puppeteer-extra-plugin-recaptcha";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Page } from "puppeteer-core";
import * as pptrBrowsers from "@puppeteer/browsers";
import Papa from "papaparse";
import ms, { StringValue as MsString } from "ms";

puppeteer.use(StealthPlugin());
puppeteer.use(RecaptchaPlugin({ visualFeedback: true }));

const idList = new Set<string>();
const idMap = new Map<string, Record<string, string>>();
const skippedPages: string[] = [];

process.on("unhandledRejection", (reason, promise) => {
  console.warn("Unhandled Rejection at:", promise, "reason:", reason);
});

const originalConsole = console;
Object.assign(globalThis, { originalConsole });

const patchConsole = async (pageRef: WeakRef<Page>) => {
  {
    const page = pageRef.deref();
    if (!page) return;

    page.exposeFunction(
      "callNodeConsole",
      (methodName: keyof Console, ...args: any[]) => {
        originalConsole.log("callNodeConsole", { methodName, args });
        (originalConsole[methodName] as any)(...args);
      }
    );

    page.evaluate(() => {
      const originalConsole = globalThis.console;
      Object.assign(globalThis, {
        originalConsole,
        console: new Proxy(originalConsole, {
          get(target, prop, receiver) {
            originalConsole.log("get", { target, prop, receiver });
            const originalValue = Reflect.get(target, prop, receiver);
            if (typeof originalValue === "function") {
              return (...args: any[]) => {
                (originalValue as any)(...args);
                (globalThis as any).callNodeConsole(prop, ...args);
              };
            } else {
              return originalValue;
            }
          },
        }),
      });
    });
  }

  console = new Proxy(originalConsole, {
    get(target, prop, receiver) {
      const originalValue = Reflect.get(target, prop, receiver);
      if (typeof originalValue === "function") {
        return {
          [prop]: (...args: any[]) => {
            originalValue(...args);
            const page = pageRef.deref();
            if (page && !page.isClosed()) {
              page.evaluate(
                (methodName, args) => {
                  const console =
                    (globalThis as any).originalConsole ?? globalThis.console;
                  console[methodName](...args);
                },
                prop,
                args
              );
            }
          },
        }[prop as string];
      } else {
        return originalValue;
      }
    },
  });
};

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

const detectedRecaptchaIds = new Set<string>();

async function detectAndHandleRecaptchas(page: Page) {
  const timeoutInterval = ms("1s");
  setTimeout(async function timeoutCallback() {
    try {
      const { captchas } = await page.findRecaptchas();
      const hasNewCaptcha = captchas.some(({ id }) =>
        id ? !detectedRecaptchaIds.has(id) : false
      );
      captchas.forEach(({ id }) => id && detectedRecaptchaIds.add(id));

      if (hasNewCaptcha) {
        console.log("Recaptcha detectado", captchas);
        await Promise.all([
          page.bringToFront(),
          page.evaluate(() => alert("Resolva o recaptcha")),
        ]);
      }
    } finally {
      if (!page.isClosed()) setTimeout(timeoutCallback, timeoutInterval);
    }
  }, timeoutInterval);
}

const pauseBrowser = (page: Page) =>
  page.evaluate(() => {
    debugger;
  });

const takeScreenshot = (page: Page) =>
  page.screenshot({ path: "output/screenshot.png" });

const DEFAULT_TIMEOUT: MsString = "2 min";
const PPTR_BROWSERS_CACHE_DIR = path.join(os.tmpdir(), "pptr_browsers_cache");
const BROWSER_TO_INSTALL = pptrBrowsers.Browser.CHROMIUM;

async function getBrowserExecutable() {
  try {
    return await pptrBrowsers.computeSystemExecutablePath({
      browser: pptrBrowsers.Browser.CHROME,
      channel: pptrBrowsers.ChromeReleaseChannel.STABLE,
    });
  } catch {}

  console.log("Didn't find Chrome in the system. Using a bundled version.");
  const browsers = await pptrBrowsers.getInstalledBrowsers({
    cacheDir: PPTR_BROWSERS_CACHE_DIR,
  });
  if (browsers.length === 0) {
    console.log("No browsers found in cacheDir. Downloading a new one...");
    browsers.push(
      await pptrBrowsers.install({
        browser: BROWSER_TO_INSTALL,
        buildId: await pptrBrowsers.resolveBuildId(
          BROWSER_TO_INSTALL,
          pptrBrowsers.detectBrowserPlatform()!,
          "latest"
        ),
        cacheDir: PPTR_BROWSERS_CACHE_DIR,
      })
    );
  }
  return browsers[0].executablePath;
}

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

  let pageNumber: string | undefined = "1";
  console.group(`Page ${pageNumber}/${totalPages}`);
  do {
    const dedupedItemCountBefore = idList.size;
    try {
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
      await Promise.all([
        fs.writeFile(
          "output/data.json",
          JSON.stringify({ data, skippedPages })
        ),
        fs.writeFile("output/data.csv", Papa.unparse(data)),
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
