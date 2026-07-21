import __path from "path";
import Hapi from "hapi";
import Inert from "inert";
import Zen from "..";
import { fileURLToPath } from "node:url";
import { dirname as __dirnameOf } from "node:path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = __dirnameOf(__filename);
console.log(
  "If module not found, install hapi globally `npm i hapi inert -g`!",
);

const server = new Hapi.Server({
  port: 8420,
  host: "localhost",
  routes: {
    files: {
      relativeTo: __path.join(__dirname, ".."),
    },
  },
});

async function runtime() {
  const db = new Zen({
    web: server.listener,
    file: "data.json",
  });

  await server.register(Inert);

  server.route({
    method: "GET",
    path: "/zen.js",
    handler: {
      file: "zen.min.js",
    },
  });

  server.route({
    method: "GET",
    path: "/zen/nts.js",
    handler: {
      file: "nts.js",
    },
  });

  server.route({
    method: "GET",
    path: "/{param*}",
    handler: {
      directory: {
        path: __dirname,
        redirectToSlash: true,
        index: true,
      },
    },
  });

  await server.start();
  console.log("Server running at:", server.info.uri);
}

runtime();
