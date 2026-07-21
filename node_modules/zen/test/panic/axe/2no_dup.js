import ip from "ip";
import panicserver from "panic-server";
import fs from "fs";
import panicmanager from "panic-manager";
import fsrm from "./lib/fsrm";
import nodehttp from "http";
import zenapp from "./index.js";
import childproc from "child_process";
import openutil from "../util/open.js";
import { fileURLToPath } from "node:url";
import { dirname as dirnameOf } from "node:path";
const filemodname = fileURLToPath(import.meta.url);
const __dirname = dirnameOf(filemodname);
var ip;
try {
  ip = ip.address();
} catch (e) {}

var config = {
  IP: ip || "localhost",
  port: 8420,
  relays: 3,
  route: {
    "/": __dirname + "/index.html",
    "/zen.js": __dirname + "/../../zen.js",
    "/jquery.js": __dirname + "/../../examples/jquery.js",
  },
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
    config.route[req.url] &&
      fs.createReadStream(config.route[req.url]).pipe(res);
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

// continue boiler plate, tweak a few defaults if needed, but give descriptive test names...
describe("Put ACK", function () {
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
            while (i--) {
              // make sure to connect to self/same.
              var tmp = env.config.port + (i + 1);
              peers.push("http://" + env.config.IP + ":" + tmp + "/zen");
            }
            global.peerID = String.fromCharCode(64 + env.i);
            console.log(env.i, port, " connect to ", peers);

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
            // TODO what should zen be when testing on rod?
            var zen = Zen({
              file: env.i + "data",
              pid: peerID,
              peers: peers,
              web: server,
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

  it("Drop duplicates", function () {
    var tests = [],
      i = 0;
    relays.each(function (client) {
      tests.push(
        client.run(
          function (test) {
            var env = test.props;
            test.async();
            var peers = zen.back("opt.peers");

            zen.get("test").on(function (a) {}); // connections are lazy, so trigger a read. A feature, tho also a bug in this case, should probably have its own tests to determine if this ought be intended or not.

            setTimeout(function () {
              var p = [],
                o = {},
                err;
              Object.keys(peers).forEach(function (id) {
                id = peers[id];
                p.push(id.pid);
                err = err || (o[id.pid] = (o[id.pid] || 0) + 1) - 1;
              });
              console.log(peerID, "connected to:", p);
              if (p.length > 2 || err) {
                console.log("FAIL: too_many_connections");
                too_many_connections;
                return;
              }
              test.done();
            }, 2000);
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
