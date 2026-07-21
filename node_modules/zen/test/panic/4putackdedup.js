import ip from "ip";
import panicserver from "panic-server";
import fs from "fs";
import panicmanager from "panic-manager";
import fsrm from "./lib/fsrm";
import nodehttp from "http";
import zenapp from "./index.js";
import childproc from "child_process";
import openutil from "./util/open.js";
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
  relays: 1,
  browsers: 9,
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
var r1 = relays.pluck(1);
var browsers = clients.excluding(relays);
var b1 = browsers.pluck(1);
var others = browsers.excluding(b1);
var b2 = relays.excluding(b1).pluck(1);
var b3 = relays.excluding([b1, b2]).pluck(1);
var b4 = relays.excluding([b1, b2]).pluck(1);
var b5 = relays.excluding([b1, b2]).pluck(1);

// continue boiler plate, tweak a few defaults if needed, but give descriptive test names...
describe("Dedup load balancing GETs", function () {
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
              var tmp = env.config.port + (i + 1);
              if (port != tmp) {
                // ignore ourselves
                peers.push("http://" + env.config.IP + ":" + tmp + "/zen");
              }
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

            var zen = Zen({
              peers: peers,
              web: server,
              rad: false,
              radisk: false,
              file: false,
              localStorage: false,
            });
            server.listen(port, function () {
              test.done();
            });

            //zen.get('test').put({tmp: 1}); // temporary workaround for bug.
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
            try {
              localStorage.clear();
            } catch (e) {}
            try {
              indexedDB.deleteDatabase("radata");
            } catch (e) {}

            // start with the first peer:
            var env = test.props;
            var zen = Zen({
              peers:
                "http://" +
                env.config.IP +
                ":" +
                (env.config.port + 1) +
                "/zen",
              localStorage: false,
            });

            window.zen = zen;
            window.ref = zen.get("test");

            ref.on(function (data) {});
          },
          { i: (i += 1), config: config },
        ),
      );
    });
    return Promise.all(tests);
  });

  it("ACK", function () {
    var tests = [],
      i = 0;
    others.each(function (browser, id) {
      tests.push(
        browser.run(
          function (test) {
            var id = test.props.i;

            // these lines are for debugging...
            /*var dam = ref.back('opt.mesh');
				var say = dam.say;
				dam.say = function(raw, peer){
					say(raw, peer);
					//console.log("said:", JSON.stringify(raw));
				}
				var hear = dam.hear;
				dam.hear = function(raw, peer){
					//console.log("heard:", raw);
					hear(raw, peer);
				}*/

            zen.on("put", function (msg) {
              var ok = msg.ok;
              if (ok["@"] > 2) {
                console.log("Relay did not decrement!");
                test.fail("Relay did not decrement!");
                _relay_did_not_decrement;
                return;
              }
              if (Math.random() > ok["@"] / ok["/"]) {
                return;
              }
              //console.log("WAS THE SPECIAL ONE TO ACK!", JSON.stringify(msg));
              zen.on("out", { "@": msg["#"], ok: { yay: 1 } });
            });
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
    }, 2000);
  });

  it("Alice saves data", function () {
    return b1.run(
      function (test) {
        test.async();

        // these lines are for debugging...
        /*var dam = ref.back('opt.mesh');
			var say = dam.say;
			dam.say = function(raw, peer){
				say(raw, peer);
				//console.log("said:", JSON.stringify(raw), dam.near, Object.keys(zen._.opt.peers).join(','));
			}
			var hear = dam.hear;
			dam.hear = function(raw, peer){
				hear(raw, peer);
				//console.log("heard:", raw);
			}*/

        var many = test.props.config.browsers;
        console.log("Alice is saving...");
        test.c = 0;
        ref.put(
          { hello: "world" },
          function (ack) {
            if (!ack.ok.yay) {
              test.fail("ERROR: No custom ack!");
              console.log("ERROR: No custom ack!");
              return no_custom_ack;
            }
            //console.log("I saved data, this is the ACK", JSON.stringify(ack));
            test.c++;
            clearTimeout(test.to);
            test.to = setTimeout(function () {
              if (test.c >= many / 2) {
                test.fail("ERROR: Too many acks!");
                console.log("ERROR: Too many acks!");
                return too_many_acks;
              }
              test.done();
            }, 999);
          },
          { ok: 3, acks: 9999 },
        );
      },
      { config: config },
    );
  });

  it("All finished!", function (done) {
    console.log("Done! Cleaning things up...");
    setTimeout(function () {
      done();
    }, 1000);
  });

  after("Everything shut down.", function () {
    console.log("REMINDER: RUN THIS TEST WITH AXE ON & OFF!");
    openutil.cleanup();
    return relays.run(function () {
      process.exit();
    });
  });
});
