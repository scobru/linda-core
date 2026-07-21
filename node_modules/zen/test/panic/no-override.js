import ip from "ip";
import fs from "fs";
import panicmanager from "panic-manager";
import fsrm from "./lib/fsrm";
import nodehttp from "http";
import zenapp from "./index.js";
import openutil from "./util/open.js";
import panic from "panic-server";
import { fileURLToPath } from "node:url";
import { dirname as dirnameOf } from "node:path";
const filemodname = fileURLToPath(import.meta.url);
const __dirname = dirnameOf(filemodname);

var config = {
  IP: ip.address(),
  port: 8420,
  servers: 1,
  browsers: 1,
  route: {
    "/": __dirname + "/index.html",
    "/zen.js": __dirname + "/../../zen.js",
    "/jquery.js": __dirname + "/../../examples/jquery.js",
  },
};

panic
  .server()
  .on("request", function (req, res) {
    config.route[req.url] &&
      fs.createReadStream(config.route[req.url]).pipe(res);
  })
  .listen(config.port);

var clients = panic.clients;
var manager = panicmanager();

manager.start({
  clients: Array(config.servers)
    .fill()
    .map(function (u, i) {
      return {
        type: "node",
        port: config.port + (i + 1),
      };
    }),
  panic: "http://" + config.IP + ":" + config.port,
});

var servers = clients.filter("Node.js");
var server = servers.pluck(1);
var spawn = servers.excluding(server).pluck(1);
var browsers = clients.excluding(servers);
var alice = browsers.pluck(1);
var again = {};

describe("No Empty Object on .Once", function () {
  //this.timeout(5 * 60 * 1000);
  this.timeout(10 * 60 * 1000);

  it("Servers have joined!", function () {
    return servers.atLeast(config.servers);
  });

  it("ZEN started!", function () {
    return server.run(
      function (test) {
        var env = test.props;
        test.async();
        try {
          fs.unlinkSync(env.i + "data");
        } catch (e) {}
        try {
          fs.unlinkSync(env.i + 1 + "data");
        } catch (e) {}
        try {
          fsrm(env.i + "data");
        } catch (e) {}
        try {
          fsrm(env.i + 1 + "data");
        } catch (e) {}
        var port = env.config.port + env.i;
        var server = nodehttp.createServer(function (req, res) {
          res.end("I am " + env.i + "!");
        });
        var Zen = zenapp;
        var zen = Zen({ file: env.i + "data", web: server });
        server.listen(port, function () {});
        setTimeout(function () {
          zen.get("survey").get("231119").get("x").put({ z: 1 });
          zen.get("survey").get("231119").get("y").put({ z: 1 });
          zen
            .get("survey")
            .get("231119")
            .once(function (data) {
              console.log(data);
              if (!data.x || !data.y) {
                no_data_explode;
              }
              test.done();
            });
        }, 500);
      },
      { i: 1, config: config },
    );
  });

  it(config.browsers + " browser(s) have joined!", function () {
    openutil.web(config.browsers, "http://" + config.IP + ":" + config.port);
    return browsers.atLeast(config.browsers);
  });

  it("Browsers initialized zen!", function () {
    var tests = [],
      i = 0;
    browsers.each(function (client, id) {
      tests.push(
        client.run(
          function (test) {
            localStorage.clear();
            var env = test.props;
            var zen = Zen(
              "http://" + env.config.IP + ":" + (env.config.port + 1) + "/zen",
            );
            window.ref = zen.get("survey").get("231119");
          },
          { i: (i += 1), config: config },
        ),
      );
    });
    return Promise.all(tests);
  });

  it("Write initial value", function () {
    return alice.run(function (test) {
      test.async();
      console.log("I AM ALICE");
      ref.get("z").put({ z: 1 });
      setTimeout(function () {
        ref.once(function (data) {
          console.log("DOES X Y & Z EXIST?", data);
          if (!data.x || !data.y || !data.z) {
            test.fail("overwrote old object!");
            return;
          }
          test.done();
        });
      }, 500);
    });
  });

  it("All finished!", function (done) {
    console.log("Done! Cleaning things up...");
    setTimeout(function () {
      done();
    }, 1000);
  });

  after("Everything shut down.", function () {
    openutil.cleanup();
    return servers.run(function () {
      process.exit();
    });
  });
});
