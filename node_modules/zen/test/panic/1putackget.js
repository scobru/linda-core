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
  relays: 2,
  browsers: 2,
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
var bob = relays.pluck(1);
var carl = relays.excluding(bob).pluck(1);
var browsers = clients.excluding(relays);
var alice = browsers.pluck(1);
var dave = browsers.excluding(alice).pluck(1);

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
              var tmp = env.config.port + (i + 1);
              if (port != tmp) {
                // ignore ourselves
                peers.push("http://" + env.config.IP + ":" + tmp + "/zen");
              }
            }

            if (process.env.ROD_PATH) {
              // currently fails because rod doesn't ack
              console.log("testing with rod");
              const sp = childproc.spawn(process.env.ROD_PATH, [
                "start",
                "--port",
                port,
                "--sled-storage=false",
                "--peers",
                peers.join(",").replaceAll("http", "ws"),
              ]);
              sp.stdout.on("data", function (data) {
                console.log(data.toString());
              });
              sp.stderr.on("data", function (data) {
                console.log(data.toString());
              });
              test.done();
              return;
            }

            console.log(port, " connect to ", peers);
            var zen = Zen({
              file: env.i + "data",
              peers: peers,
              web: server,
              axe: false,
            }); // Note: test with AXE on & off.
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
            try {
              localStorage.clear();
            } catch (e) {}
            try {
              indexedDB.deleteDatabase("radata");
            } catch (e) {}
            var env = test.props;

            var zen = Zen(
              "http://" + env.config.IP + ":" + (env.config.port + 1) + "/zen",
            );
            window.ref = zen.get("a");
          },
          { i: (i += 1), config: config },
        ),
      );
    });
    return Promise.all(tests);
  });
  // end PANIC template -->

  it("Put", function () {
    return alice.run(
      function (test) {
        console.log("I AM ALICE");
        test.async();
        var c = test.props.acks,
          acks = {},
          tmp;
        c = c < 2 ? 2 : c; // at least 2 acks.
        ref.put(
          { hello: "world" },
          function (ack) {
            acks[ack["#"]] = 1; // uniquely list all the ack IDs.
            tmp = Object.keys(acks).length;
            if (tmp >= c) {
              // when there are enough
              setTimeout(function () {
                test.done(); // confirm test passes
                wire(); // start sniffing for future tests
              }, 1000 * 2);
              return;
            }
          },
          { acks: c, ok: c * 10 },
        ); // TODO: Upon breaking change (> 2020) update this test with the deprecated `acks` behavior.

        function wire() {
          // for the future tests, track how many wire messages are heard/sent.
          ref.hear = ref.hear || [];
          var dam = ref.back("opt.mesh");
          var hear = dam.hear;
          dam.hear = function (raw, peer) {
            hear(raw, peer);
            ref.hear.push(raw);
          };

          var peers = ref.back("opt.peers");
          Object.keys(peers).forEach(function (peer) {
            peer = peers[peer];
            peer.say = function (raw) {
              (ref.say || (ref.say = [])).push(raw); // add to count.
              peer.wire.send(raw);
            };
          });
        }
      },
      { acks: config.relays },
    );
  });

  it("Get", function () {
    /*
			Here is the recursive rule for GET, keep replying while hashes mismatch.
			1. Receive a GET message.
			2. If it has a hash, and if you have a thing matching the GET, then see if the hashes are the same, if they are then don't ACK, don't relay, end. (Tho subscribe them)
			3. If you would have the thing but do not, then ACK that YOU have nothing.
			4. If you have a thing matching the GET or an ACK for the GET's message, add the hash to the GET message, and ACK with the thing or ideally the remaining difference.
			5. Pick ?3? OTHER peers preferably by priority that they have got the thing, send them the GET, plus to all "up" peers.
			6. If no ACKs you are done, end. (Or sample other peers until confident)
			7. If you get ACKs back to the GET with things and different hashes, optionally merge into the thing you have GOT and update the hash.
			8. Go to 4.
			// Deduplicated reply hashes cannot be global, they need to be request specific to avoid other bugs.
		*/
    return dave.run(
      function (test) {
        console.log("I AM DAVE");
        test.async();
        var c = 0,
          to;
        ref.hear = ref.hear || [];
        var dam = ref.back("opt.mesh");
        var hear = dam.hear;
        dam.hear = function (raw, peer) {
          // hijack listener
          var msg = JSON.parse(raw);
          //console.log('hear:', msg);
          hear(raw, peer);
          ref.hear.push(msg);

          if (msg.put) {
            ++c;
          } // count how many acks our GET gets.
        };
        ref.get(function (ack) {
          // GET data
          if (!ack.put || ack.put.hello !== "world") {
            return;
          } // reject any wrong data.
          // because the data is the same on all peers,
          // we should only get 1 ack because the others dedup off the 1st ACK's hash.
          if (c > 1) {
            return too_many_acks;
          }

          clearTimeout(to);
          to = setTimeout(test.done, 1000);
        });
      },
      { acks: config.relays },
    );
  });

  it("DAM", function () {
    return alice.run(
      function (test) {
        test.async();
        if (ref.hear.length > 1) {
          return heard_to_much;
        } // Alice should hear the GET
        if (ref.say) {
          return said_too_much;
        } // But should not reply because their reply hash dedups with an earlier reply that was added to the GET.
        test.done();
      },
      { acks: config.relays },
    );
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
