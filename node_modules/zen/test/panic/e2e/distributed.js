import zenapp from "../index.js";
import panicserver from "panic-server";
import nodehttp from "http";
import nodepath from "path";
import fs from "fs";
import __selenium_webdriver from "selenium-webdriver";
import "./holy/grail.js";
import { fileURLToPath } from "node:url";
import { dirname as dirnameOf } from "node:path";
const filemodname = fileURLToPath(import.meta.url);
const __dirname = dirnameOf(filemodname);

describe("PANIC!", function () {
  this.timeout(1000 * 100);

  var Zen = zenapp;

  var panic = panicserver;

  var server = nodehttp.createServer(function (req, res) {
    var path = nodepath;
    if (req.url === "/") {
      req.url = "/panic.html";
    }
    var file =
      req.url === "/panic.html"
        ? path.join(__dirname, "..", "panic.html")
        : path.join(__dirname, req.url);
    fs
      .createReadStream(file)
      .on("error", function () {})
      .pipe(res); // stream
  });

  var zen = Zen({
    web: server,
  });

  panic.server(server);
  server.listen(8420);

  var clients = panic.clients;

  var wd = __selenium_webdriver;
  var ff1 = new wd.Builder()
    .forBrowser("firefox")
    .build()
    .get("http://localhost:8420/panic.html");
  var ff2 = new wd.Builder()
    .forBrowser("firefox")
    .build()
    .get("http://localhost:8420/panic.html");

  function min(n, done, list) {
    list = list || clients;
    function ready() {
      if (list.length >= n) {
        done();
        list.removeListener("add", ready);
        return true;
      }
    }
    if (!ready()) {
      list.on("add", ready);
    }
  }

  function gunify(done, ctx) {
    var s = document.createElement("script");
    s.src = "zen.js";
    s.onload = done;
    s.onerror = ctx.fail;
    document.body.appendChild(s);
  }

  describe("Should sync", function () {
    var alice = clients.pluck(1);
    var bob = clients.excluding(alice).pluck(1);

    before(function (done) {
      min(2, done, clients);
    });

    it("browsers", function (done) {
      alice
        .run(function () {
          var sync = zen.get("sync");
          sync.put({ hello: "world" });
        })
        .then(function () {
          return bob.run(function (done, ctx) {
            var sync = zen.get("sync");
            sync.on(function (val) {
              if (val.hello === "world") {
                done();
              } else {
                ctx.fail("Wrong data");
              }
            });
          });
        })
        .then(function () {
          done();
        })
        .catch(function (e) {
          done(new Error(e.message));
        });
    });
  });
});
