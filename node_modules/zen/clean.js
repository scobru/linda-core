import fs from "node:fs";

// CWD-relative cleanup — npm scripts always run from project root
const drop = ["tmp", "radata", "radatatest", "data", "data.json"];
for (const d of drop) {
  try {
    fs.rmSync(d, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  } catch (e) {}
}
for (const name of fs.readdirSync(".")) {
  if (name.startsWith("radatatest-") || name.startsWith("radata-")) {
    try {
      fs.rmSync(name, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      });
    } catch (e) {}
  }
}
