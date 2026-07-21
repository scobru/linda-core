import ip from "ip";
import panicserver from "panic-server";
import fs from "fs";
import panicmanager from "panic-manager";
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
var bob = relays.pluck(1);
var fred = relays.excluding(bob).pluck(1);
var ed = relays.excluding([bob, fred]).pluck(1);
var browsers = clients.excluding(relays);
var alice = browsers.pluck(1);
var carl = browsers.excluding(alice).pluck(1);
var dave = browsers.excluding([alice, carl]).pluck(1);
var cd = new panic.ClientList([carl, dave]);

// continue boiler plate, tweak a few defaults if needed, but give descriptive test names...
describe("GET GET", function () {
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
            Object.PORT = port;
            console.log(port, " connect to ", peers);
            var zen = Zen({
              file: env.i + "data",
              peers: peers,
              web: server,
              multicast: false,
            });
            server.listen(port, function () {
              test.done();
            });
            global.zen = zen;
            global.WHO = port;
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
            window.ID = test.props.i;

            var zen = Zen({
              peers:
                "http://" +
                env.config.IP +
                ":" +
                (env.config.port + (ID === 1 ? 2 : 1)) +
                "/zen",
              localStorage: false,
            });
            window.zen = zen;
            window.ref = zen.get("a"); //.on(function(){ });
          },
          { i: (i += 1), config: config },
        ),
      );
    });
    return Promise.all(tests);
  });
  // end PANIC template -->

  it("connect", function () {
    return alice.run(function (test) {
      console.log("I AM ALICE");
      window.WHO = "Alice";
      test.async();
      zen.get("random").get(function (ack) {
        setTimeout(function () {
          test.done();
        }, 1000);
      });
    });
  });

  it("Put", function () {
    return alice.run(function (test) {
      test.async();

      var dam = ref.back("opt.mesh");
      var say = dam.say;
      dam.say = function () {}; // prevent from syncing

      var c = 0;
      ref.put({ hello: "world" }, function (ack) {
        ++c;
      }); // count acks, which should be none because disconnected
      setTimeout(function () {
        if (c) {
          return should_not_have_ack;
        } // make sure there were none.
        dam.say = say; // restore normal code
        test.done();

        zen.get("a").on(function (data) {});
      }, 1000);
    });
  });

  it("Get", function () {
    return cd.run(function (test) {
      test.async();
      console.log("I am Carl or Dave");
      window.WHO = "Carl";
      ref.get(function (ack) {
        // this makes sure data was found p2p, even without subscription knowledge.
        if (ack.put) {
          test.done();
        }
      });
    });
  });

  it("Dave pushes changes", function () {
    return dave.run(function (test) {
      window.WHO = "Dave";
      test.async();
      ref.put({ hello: "dave" });
      setTimeout(test.done, 2 * 1000);
    });
  });

  it("All updated, but not Ed.", function () {
    var tests = [],
      i = 0;
    clients.excluding(ed).each(function (client, id) {
      tests.push(
        client.run(function (test) {
          test.async();
          console.log(WHO, "cache:", JSON.stringify(zen._.graph.a));
          if ("dave" !== zen._.graph.a.hello) {
            throw new Error("not_updated");
            return not_updated;
          }
          test.done();
        }),
      );
    });
    return Promise.all(tests);
  });

  it("Ed NOT subscribed", function () {
    return ed.run(function (test) {
      test.async();

      console.log("Ed's cache:", JSON.stringify(zen._.graph.a));
      if (zen._.graph.a) {
        throw new Error("was_updated");
        return was_updated;
      }
      test.done();
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
    return relays.run(function () {
      process.exit();
    });
  });
});
