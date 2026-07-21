import nodePath from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = fileURLToPath(import.meta.url);
const rootDir = nodePath.resolve(nodePath.dirname(here), "..", "..");
const zenUrl = pathToFileURL(nodePath.join(rootDir, "zen.js")).href;
const zenMinUrl = pathToFileURL(nodePath.join(rootDir, "zen.min.js")).href;

export async function resolve(specifier, context, defaultResolve) {
  const resolved = await defaultResolve(specifier, context, defaultResolve);
  if (resolved.url === zenUrl) {
    return { ...resolved, url: zenMinUrl };
  }
  return resolved;
}
