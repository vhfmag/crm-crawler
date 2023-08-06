import { Page } from "puppeteer-core";
import fs from "node:fs";

const originalConsole = console;
Object.assign(globalThis, { originalConsole });

type WriteStreamName = NonNullable<
  {
    [K in keyof typeof process]: (typeof process)[K] extends NodeJS.WriteStream
      ? K
      : never;
  }[keyof typeof process]
>;

export const persistLogs = (streamName: WriteStreamName) => {
  const fileStream = fs.createWriteStream(`output/${streamName}.log`);
  const originalStreamWrite = process[streamName].write.bind(
    process[streamName]
  );
  process[streamName].write = (...args) => {
    (fileStream.write as any)(...args);
    return (originalStreamWrite as any)(...args);
  };
};

export const patchConsole = async (pageRef: WeakRef<Page>) => {
  {
    const page = pageRef.deref();
    if (!page) return;

    await page.exposeFunction(
      "callNodeConsole",
      (methodName: keyof Console, ...args: any[]) => {
        (originalConsole[methodName] as any)(...args);
      }
    );

    await page.evaluate(() => {
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
