import fs from "fs";
import nodehttps from "https";
import nodepath from "path";
import zenapp from "../../index.js";
import { fileURLToPath } from "node:url";
import { dirname as dirnameOf } from "node:path";
const filemodname = fileURLToPath(import.meta.url);
const __dirname = dirnameOf(filemodname);

export default function (port, file, cb, inject) {
  port =
    port ||
    process.env.OPENSHIFT_NODEJS_PORT ||
    process.env.VCAP_APP_PORT ||
    process.env.PORT ||
    process.argv[2] ||
    8420;

  var fs = fs;
  var Zen = zenapp;

  var server = nodehttps.createServer(
    {
      key: fs.readFileSync(__dirname + "/server.key"),
      cert: fs.readFileSync(__dirname + "/server.crt"),
      ca: fs.readFileSync(__dirname + "/ca.crt"),
      requestCert: true,
      rejectUnauthorized: false,
    },
    function (req, res) {
      if (Zen.serve(req, res)) {
        return;
      } // filters zen requests!
      var file;
      try {
        file = fs.readFileSync(
          nodepath.join(__dirname + "/../../examples", req.url),
        );
      } catch (e) {
        file = fs.readFileSync(
          nodepath.join(__dirname + "/../../examples", "index.html"),
        );
      }
      if (inject) {
        file = inject(file, req, res) || file;
      }
      res.end(file);
    },
  );

  var zen = Zen({
    file: file || "data",
    web: server,
    localStorage: false,
  });

  server.listen(port, cb);

  console.log("Server started on port " + port + " with /zen");
}
