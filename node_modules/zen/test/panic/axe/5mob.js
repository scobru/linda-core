import ip from "ip";
import panicserver from "panic-server";
import fs from "fs";
import panicmanager from "panic-manager";
import childproc from "child_process";
import fsrm from "./lib/fsrm";
import nodehttp from "http";
import zenapp from "./index.js";
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
  browsers: 3,
  route: {
    "/": __dirname + "/../index.html",
    "/zen.js": __dirname + "/../../../zen.js",
    "/jquery.js": __dirname + "/../../../examples/jquery.js",
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
var r1 = relays.pluck(1);
var r2 = relays.excluding(r1).pluck(1);
var r3 = relays.excluding([r1, r2]).pluck(1);
var browsers = clients.excluding(relays);
var b1 = browsers.pluck(1);
var b2 = relays.excluding(b1).pluck(1);
var b3 = relays.excluding([b1, b2]).pluck(1);

// continue boiler plate, tweak a few defaults if needed, but give descriptive test names...
describe("Mob test.", function () {
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
            var port = env.config.port + env.i;
            test.async();

            var peers = [],
              i = env.config.relays;
            while (i--) {
              // make sure to connect to self/same.
              var tmp = env.config.port + (i + 1);
              peers.push("http://" + env.config.IP + ":" + tmp + "/zen");
            }

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

            try {
              fs.unlinkSync(env.i + "data");
            } catch (e) {}
            try {
              fsrm(env.i + "data");
            } catch (e) {}
            var server = nodehttp.createServer(function (req, res) {
              res.end("I am " + env.i + "!");
            });
            var Zen;
            try {
              Zen = zenapp;
            } catch (e) {
              console.log(
                "ZEN not found! You need to link ZEN to PANIC. Nesting the `zen` repo inside a `node_modules` parent folder often fixes this.",
              );
            }

            console.log(port, " connect to ", peers);
            var zen = Zen({
              file: env.i + "data",
              peers: peers,
              web: server,
              mob: 3,
              multicast: false,
            });
            global.zen = zen;
            server.listen(port, function () {
              test.done();
            });

            zen.get("a").on(function () {}); // TODO: Wrong! This is an example of the test using ZEN in weird ways to work around bugs at the time of writing. This line should not be necessary, AXE should still pass even if this line is commented out, however if it fails then that is a bug in ZEN's logic, not AXE.
          },
          { i: (i += 1), config: config },
        ),
      );
    });
    return Promise.all(tests);
  });

  it(config.browsers + " browser(s) have joined!", function () {
    openutil.web(config.browsers, "http://" + config.IP + ":" + config.port);
    return browsers.atLeast(config.browsers);
  });
  // end PANIC template -->

  it("Browsers initialized zen!", function () {
    var tests = [],
      i = 0;
    browsers.each(function (browser, id) {
      tests.push(
        browser.run(
          function (test) {
            test.async();
            try {
              localStorage.clear();
            } catch (e) {}
            try {
              indexedDB.deleteDatabase("radata");
            } catch (e) {}

            // start with the first peer:
            var env = test.props;
            var zen = Zen(
              "http://" + env.config.IP + ":" + (env.config.port + 1) + "/zen",
            );

            // NOTE: This "mob" logic will be moved into axe.js (or maybe zen.js itself), but while we're building the logic it is easier to quickly hack/iterate by prototyping here in the test itself until it passes. But it needs to be refactored into the actual code or else you might have false positives of this test overloading "mob" logic.
            // ^^^^^^^^^ THIS HAS BEEN MOVED TO ZEN CORE, HOWEVER,
            // ^^^^^^^^^ EXPERIMENT WITH MORE ADVANCED LOGIC THAT AXE OVERLOADS CORE.
            var mesh = zen.back("opt.mesh"); // overload...
            /*mesh.hear['mob'] = function(msg, peer){
					// TODO: NOTE, code AXE DHT to aggressively drop new peers AFTER superpeer sends this rebalance/disconnect message that contains some other superpeers.
					clearTimeout(zen.TO); zen.TO = setTimeout(end, 2000);
					if(!msg.peers){ return }
					var peers = Object.keys(msg.peers), one = peers[Math.floor(Math.random()*peers.length)];
					console.log('Browser', env.i, 'chooses', one, 'from', JSON.stringify(peers), 'that', peer.url, 'suggested, because it is mobbed.');//, 'from', msg.peers+'');
					mesh.bye(peer); // Idea: Should keep track of failed ones to reduce repeats. For another feature/module that deserves its own separate test.
					mesh.hi(one);
				}*/

            //console.log('Browser', env.i, "started with:", Object.keys(zen._.opt.peers)+'');
            window.zen = zen;
            window.ref = zen.get("test");
            function end() {
              test.done();
            }
            zen.TO = setTimeout(end, 3000);
          },
          { i: (i += 1), config: config },
        ),
      );
    });
    return Promise.all(tests);
  });

  it("wait...", function (done) {
    setTimeout(function () {
      done();
    }, 3000);
  });

  it("Got Load Balanced to Different Peer", function () {
    var tests = [],
      i = 0;
    browsers.each(function (browser, id) {
      tests.push(
        browser.run(
          function (test) {
            test.async();
            ref
              .get("b" + test.props.i)
              .put("" + Object.keys(zen.back("opt.peers")));
            // NOTE: Above line was put here as a workaround. Even if this line was in the prior step, this test should still pass. Make sure there is another test that correctly checks for reconnect logic properly restoring sync.

            ref.on(function (data) {
              if (!data.b1 || !data.b2 || !data.b3) {
                return;
              }
              clearTimeout(test.to);
              test.to = setTimeout(function () {
                var d = {};
                Object.keys(data)
                  .sort()
                  .forEach(function (i) {
                    d[i] = data[i];
                  });
                delete d._;
                console.log(test.props.i, "sees", JSON.stringify(d));
                var now = Object.keys(zen.back("opt.peers"));
                if (now.length > 1) {
                  console.log("FAIL: too_many_connections");
                  too_many_connections;
                  return;
                }
                var not = {};
                Object.keys(data).forEach(function (k, v) {
                  v = data[k];
                  if ("_" === k) {
                    return;
                  }
                  if (v.split(",").length > 1) {
                    console.log("FAIL: too_many");
                    too_many;
                    return;
                  }
                  if (not[v]) {
                    console.log("FAIL: already");
                    already_;
                    return;
                  }
                  not[v] = 1;
                });
                test.done();
              }, 2000);
            });
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
    }, 1000);
  });

  after("Everything shut down.", function () {
    openutil.cleanup();
    return relays.run(function () {
      process.exit();
    });
  });
});
