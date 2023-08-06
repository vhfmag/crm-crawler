import ms from "ms";
import { Page } from "puppeteer-core";

const detectedRecaptchaIds = new Set<string>();
const recaptchaCheckInterval = ms("1s");

export async function detectAndHandleRecaptchas(page: Page) {
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
      if (!page.isClosed()) setTimeout(timeoutCallback, recaptchaCheckInterval);
    }
  }, recaptchaCheckInterval);
}
