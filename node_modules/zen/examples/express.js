import express from "express";
import Zen from "..";
import "../lib/axe.js";
import { fileURLToPath } from "node:url";
import { dirname as __dirnameOf } from "node:path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = __dirnameOf(__filename);
console.log(
  "If module not found, install express globally `npm i express -g`!",
);
var port =
  process.env.OPENSHIFT_NODEJS_PORT ||
  process.env.VCAP_APP_PORT ||
  process.env.PORT ||
  process.argv[2] ||
  8420;
var app = express();
app.use(Zen.serve);
app.use(express.static(__dirname));

var server = app.listen(port);
var zen = Zen({ file: "data", web: server });

global.ZEN = Zen; /// make global to `node --inspect` - debug only
global.zen = zen; /// make global to `node --inspect` - debug only

console.log("Server started on port " + port + " with /zen");
