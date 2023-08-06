import { Page } from "puppeteer-core";

const originalConsole = console;
Object.assign(globalThis, { originalConsole });

export const patchConsole = async (pageRef: WeakRef<Page>) => {
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
