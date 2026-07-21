import Zen from "../../index.js";
import { fileURLToPath } from "node:url";
import { dirname as dirnameOf } from "node:path";
const filemodname = fileURLToPath(import.meta.url);
const __dirname = dirnameOf(filemodname);
var zen = Zen({ file: __dirname + "/old2020json" });

zen.get("test").once(function (data, key) {
  console.log(key, data);
  if (!data) {
    throw "not compatible!";
  }
});
