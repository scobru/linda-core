import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./test/loaders/zen-minified.mjs", pathToFileURL("./"));
