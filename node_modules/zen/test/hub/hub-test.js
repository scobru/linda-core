import os from "os";
import Zen from "../../index.js";
import hub from "../../lib/hub.js";
import { fileURLToPath } from "node:url";
import { dirname as dirnameOf } from "node:path";
const filemodname = fileURLToPath(import.meta.url);
const __dirname = dirnameOf(filemodname);
const zen = Zen();

zen.get("hub").on((data) => {
  console.log(data);
});

hub.watch(__dirname, {
  msg: true,
  hubignore: true,
  alias: os.userInfo().username,
});
