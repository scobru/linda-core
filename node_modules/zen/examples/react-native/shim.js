import __buffer from "buffer";
import { fileURLToPath } from "node:url";
import { dirname as __dirnameOf } from "node:path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = __dirnameOf(__filename);
if (typeof __dirname === "undefined") global.__dirname = "/";
if (typeof __filename === "undefined") global.__filename = "";

if (typeof Buffer === "undefined") global.Buffer = __buffer.Buffer;

const isDev = typeof __DEV__ === "boolean" && __DEV__;
process.env["NODE_ENV"] = isDev ? "development" : "production";
if (typeof localStorage !== "undefined") {
  localStorage.debug = isDev ? "*" : "";
}

global.location = {
  protocol: "file:",
  host: "",
};

global.TextDecoder = TextDecoder;
global.TextEncoder = TextEncoder;
