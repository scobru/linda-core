import ip from "ip";
import panicserver from "panic-server";
import panicmanager from "panic-manager";
import fs from "fs";
import fsrm from "./lib/fsrm";
import nodehttp from "http";
import zenapp from "./index.js";
import childproc from "child_process";
import openutil from "../util/open.js";
var ip;
try {
  ip = ip.address();
} catch (e) {}

var config = {
  IP: ip || "localhost",
  port: 8420,
  relays: 1,
};

var panic;
try {
  panic = panicserver;
} catch (e) {
  console.log(
    "PANIC not installed! `npm install panic-server panic-manager panic-client`",
  );
}

panic
  .server()
  .on("request", function (req, res) {
    //config.route[req.url] && load('fs').createReadStream(config.route[req.url]).pipe(res);
  })
  .listen(config.port);

var clients = panic.clients;
var manager = panicmanager();

manager.start({
  clients: Array(config.relays)
    .fill()
    .map(function (u, i) {
      return {
        type: "node",
        port: config.port + (i + 1),
      };
    }),
  panic: "http://" + config.IP + ":" + config.port,
});

var relays = clients.filter("Node.js");
var alice = relays.pluck(1);

// continue boiler plate, tweak a few defaults if needed, but give descriptive test names...
describe("Do not connect to self", function () {
  //this.timeout(5 * 60 * 1000);
  this.timeout(10 * 60 * 1000);

  it("Relays have joined!", function () {
    return relays.atLeast(config.relays);
  });

  it("ZEN started!", function () {
    var tests = [],
      i = 0;
    relays.each(function (client) {
      tests.push(
        client.run(
          function (test) {
            var env = test.props;
            test.async();
            try {
              fs.unlinkSync(env.i + "data");
            } catch (e) {}
            try {
              fsrm(env.i + "data");
            } catch (e) {}
            var server = nodehttp.createServer(function (req, res) {
              res.end("I am " + env.i + "!");
            });
            var port = env.config.port + env.i;
            var Zen;
            try {
              Zen = zenapp;
            } catch (e) {
              console.log(
                "ZEN not found! You need to link ZEN to PANIC. Nesting the `zen` repo inside a `node_modules` parent folder often fixes this.",
              );
            }
            var peers = [],
              i = env.config.relays;
            global.self_url = "http://" + env.config.IP + ":" + port + "/zen";
            // make sure to connect to self/same.
            peers.push(self_url);
            console.log(port, " connect to ", peers);

            if (process.env.ROD_PATH) {
              console.log("testing with rod");
              var args = ["start", "--port", port, "--sled-storage=false"];
              if (peers.length) {
                args.push(
                  "--peers=" + peers.join(",").replaceAll("http", "ws"),
                );
              }
              const sp = childproc.spawn(process.env.ROD_PATH, args);
              sp.stdout.on("data", function (data) {
                console.log(data.toString());
              });
              sp.stderr.on("data", function (data) {
                console.log(data.toString());
              });
              test.done();
              return;
            }

            var zen = Zen({
              file: env.i + "data",
              peers: peers,
              web: server,
              multicast: false,
            });
            global.zen = zen;
            server.listen(port, function () {
              test.done();
            });
          },
          { i: (i += 1), config: config },
        ),
      );
    });
    return Promise.all(tests);
  });
  // end PANIC template -->

  it("Drop self", function () {
    var tests = [],
      i = 0;
    relays.each(function (client) {
      tests.push(
        client.run(
          function (test) {
            var env = test.props;
            test.async();
            var peers = zen.back("opt.peers");
            var peer = peers[self_url];

            zen.get("test").on(function (a) {});

            setTimeout(function () {
              if (peers[self_url] || peer.wire) {
                console.log("FAIL: should_not_have_self_anymore");
                should_not_have_self_anymore;
                return;
              }
              test.done();
            }, 99);
          },
          { i: (i += 1), config: config },
        ),
      );
    });
    return Promise.all(tests);
  });

  it("All finished!", function (done) {
    console.log("Done! Cleaning things up...");
    setTimeout(function () {
      done();
    }, 1);
  });

  after("Everything shut down.", function () {
    openutil.cleanup();
    return relays.run(function () {
      process.exit();
    });
  });
});
