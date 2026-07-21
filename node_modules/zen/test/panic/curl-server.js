import ip from "ip";
import panicmanager from "panic-manager";
import express from "express";
import bodyparser from "body-parser";
import zenapp from "./index.js";
import childproc from "child_process";
import panic from "panic-server";
import { fileURLToPath } from "node:url";
import { dirname as dirnameOf } from "node:path";
const filemodname = fileURLToPath(import.meta.url);
const __dirname = dirnameOf(filemodname);

var config = {
  IP: ip.address(),
  port: 8420,
  servers: 2,
  dir: __dirname,
};

panic.server().listen(config.port);

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
var alice = servers.pluck(1);
var bob = servers.excluding(alice).pluck(1);

describe("Server to server sync", function () {
  this.timeout(5000);

  it("Servers have joined!", function () {
    return servers.atLeast(config.servers);
  });

  it("Start ZEN Bob server.", function () {
    return bob.run(
      function (test) {
        test.async();

        var express = express;
        var bodyParser = bodyparser;
        var Zen = zenapp;

        var app = express();

        app.use(Zen.serve);
        app.use(bodyParser.json());

        app.post("/foo", function (req, res) {
          zen.get("bar").put(req.body);
          res.sendStatus(200);
        });

        var server = app.listen(8082, function () {
          test.done();
        });

        var zen = Zen({ peers: "http://localhost:8081/zen", web: server });

        zen.get("bar").on(function (data, key) {
          console.log("bob", data, key);
        });
      },
      { i: 1, config: config },
    );
  });

  it("Start ZEN Alice server.", function () {
    return alice.run(
      function (test) {
        test.async();

        var express = express;
        var bodyParser = bodyparser;
        var Zen = zenapp;

        var app = express();

        app.use(Zen.serve);

        var server = app.listen(8081, function () {
          test.done();
        });

        var zen = Zen({ peers: "http://localhost:8082/zen", web: server });

        zen.get("bar").on(function (data, key) {
          console.log("alice", data, key);
          global.DATA = data;
        });
      },
      { i: 1, config: config },
    );
  });

  it("Curl Bob!", function () {
    var reply = childproc.execSync(
      "curl --request POST " +
        "--url http://localhost:8082/foo " +
        "--header 'content-type: application/json' " +
        "--data '" +
        JSON.stringify({ bar: "FOOBAR" }) +
        "'",
    );
    console.log("REPLY:", reply.toString());
    if (reply.toString().indexOf("err") >= 0) {
      console.log(reply.toString());
      throw new Error("Server did not like the request!");
    }
    return;
  });

  it("Did Alice get it?", function () {
    return alice.run(
      function (test) {
        test.async();

        setTimeout(function () {
          console.log("does Alice have it?", global.DATA);
          if (!global.DATA) {
            console.log("no data!");
            return;
          }
          test.done();
        }, 1000);
      },
      { i: 1, config: config },
    );
  });

  it("All finished!", function (done) {
    console.log("Done! Cleaning things up...");
    setTimeout(function () {
      done();
    }, 1000);
  });

  after("Everything shut down.", function () {
    return servers.run(function () {
      process.exit();
    });
  });
});
