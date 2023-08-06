import path from "node:path";
import os from "node:os";

import {
  Browser,
  resolveBuildId,
  getInstalledBrowsers,
  computeSystemExecutablePath,
  ChromeReleaseChannel,
  detectBrowserPlatform,
  install,
} from "@puppeteer/browsers";

const PPTR_BROWSERS_CACHE_DIR = path.join(os.tmpdir(), "pptr_browsers_cache");
const BROWSER_TO_INSTALL = Browser.CHROMIUM;

export async function getBrowserExecutable() {
  try {
    return await computeSystemExecutablePath({
      browser: Browser.CHROME,
      channel: ChromeReleaseChannel.STABLE,
    });
  } catch {}

  console.log("Didn't find Chrome in the system. Using a bundled version.");
  const browsers = await getInstalledBrowsers({
    cacheDir: PPTR_BROWSERS_CACHE_DIR,
  });
  if (browsers.length === 0) {
    console.log("No browsers found in cacheDir. Downloading a new one...");
    browsers.push(
      await install({
        browser: BROWSER_TO_INSTALL,
        buildId: await resolveBuildId(
          BROWSER_TO_INSTALL,
          detectBrowserPlatform()!,
          "latest"
        ),
        cacheDir: PPTR_BROWSERS_CACHE_DIR,
      })
    );
  }
  return browsers[0].executablePath;
}
