import fs from "node:fs/promises";

export const createDirIfMissing = (path: string) =>
  fs.stat(path).catch(() => fs.mkdir(path));

export const writeOutput = (path: string, content: string) =>
  fs.writeFile(path, content, { encoding: "utf-8" });
