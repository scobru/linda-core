import ip from "ip";
import panicserver from "panic-server";
import fs from "fs";
import panicmanager from "panic-manager";
import childproc from "child_process";
import fsrm from "./lib/fsrm";
import nodehttp from "http";
import zenapp from "./index.js";
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
var relay = relays.pluck(1);
var spawn = relays.excluding(relay).pluck(1);
var browsers = clients.excluding(relays);
var alice = browsers.pluck(1);
var bob = browsers.excluding(alice).pluck(1);
var again = {};

// continue boiler plate, tweak a few defaults if needed, but give descriptive test names...
describe("The Holy Grail Test!", function () {
  //this.timeout(5 * 60 * 1000);
  this.timeout(10 * 60 * 1000);

  it("relays have joined!", function () {
    return relays.atLeast(config.relays);
  });

  it("ZEN started!", function () {
    return relay.run(
      function (test) {
        var env = test.props;
        var port = env.config.port + env.i;
        test.async();

        if (process.env.ROD_PATH) {
          console.log("testing with rod");
          const sp = childproc.spawn(process.env.ROD_PATH, [
            "start",
            "--port",
            port,
            "--sled-storage=false",
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
        var zen = Zen({ file: env.i + "data", web: server });
        server.listen(port, function () {
          test.done();
        });
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
            window.ENV = test.props;
            localStorage.clear();
          },
          { i: (i += 1), config: config },
        ),
      );
    });
    return Promise.all(tests);
  });
  // end PANIC template -->

  it("Write initial value", function () {
    return alice.run(function (test) {
      console.log("I AM ALICE");
      var env = window.ENV;
      var zen = Zen({
        peers: [
          "http://" + env.config.IP + ":" + (env.config.port + 1) + "/zen",
        ],
        file: "alicedata",
      });
      window.ref = zen.get("holy").get("grail");
      ref.put("value");
      setTimeout(test.async(), 2000);
    });
  });

  it("Read initial value", function () {
    return bob.run(function (test) {
      console.log("I AM BOB");
      var env = window.ENV;
      var zen = Zen({
        peers: [
          "http://" + env.config.IP + ":" + (env.config.port + 1) + "/zen",
        ],
        file: "bobdata",
      });
      window.ref = zen.get("holy").get("grail");
      test.async();
      ref.on(function (data) {
        if ("value" === data) {
          return test.done();
        }
      });
    });
  });

  it("Relay has crashed and been wiped!", function () {
    return relay.run(
      function (test) {
        console.log(3);
        var env = test.props;
        try {
          fs.unlinkSync(env.i + "data");
        } catch (e) {}
        try {
          fsrm(env.i + "data");
        } catch (e) {}
        process.exit(0);
      },
      { i: 1, config: config },
    );
  });

  it("Wait...", function (done) {
    console.log(4);
    setTimeout(done, 2000);
  });

  it("Alice conflicted.", function () {
    return alice.run(
      function (test) {
        var env = test.props;
        if (window.WebSocket) {
          var err;
          try {
            new WebSocket(
              "http://" + env.config.IP + ":" + (env.config.port + 2) + "/zen",
            );
          } catch (e) {
            err = e;
          }
          if (!err) {
            test.fail("Relay did not crash.");
          }
        }
        ref.put("Alice");
        setTimeout(test.async(), 100);
      },
      { config: config },
    );
  });

  it("Bob conflicted.", function () {
    return bob.run(
      function (test) {
        var env = test.props;
        if (window.WebSocket) {
          var err;
          try {
            new WebSocket(
              "http://" + env.config.IP + ":" + (env.config.port + 2) + "/zen",
            );
          } catch (e) {
            err = e;
          }
          if (!err) {
            test.fail("Relay did not crash.");
          }
        }
        ref.put("Bob");
        setTimeout(test.async(), 2000);
      },
      { config: config },
    );
  });

  it("Alice reloading.", function () {
    return alice.run(function (test) {
      console.log(localStorage);
      location.reload();
    });
  });

  it("Got Alice.", function () {
    again.alice = browsers
      .excluding(new panic.ClientList([alice, bob]))
      .pluck(1);
    return again.alice.atLeast(1);
  });

  it("Wait for Bob...", function (done) {
    setTimeout(done, 1000);
  });

  it("Bob reloading.", function () {
    return bob.run(function (test) {
      location.reload();
    });
  });

  it("Got Bob.", function () {
    again.bob = browsers
      .excluding(new panic.ClientList([alice, bob, again.alice]))
      .pluck(1);
    return again.bob.atLeast(1);
  });

  it("ZEN spawned!", function () {
    return spawn.run(
      function (test) {
        var env = test.props;
        var port = env.config.port + env.i;
        test.async();

        if (process.env.ROD_PATH) {
          console.log("testing with rod");
          const sp = childproc.spawn(process.env.ROD_PATH, [
            "start",
            "--port",
            port,
            "--sled-storage=false",
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

        try {
          fs.unlinkSync(env.i + "data");
        } catch (e) {}
        try {
          fsrm(env.i + "data");
        } catch (e) {}
        var server = nodehttp.createServer(function (req, res) {
          res.end("I am " + env.i + "!");
        });
        var Zen = zenapp;
        var zen = Zen({ file: env.i + "data", web: server });
        server.listen(port, function () {
          test.done();
        });
      },
      { i: 2, config: config },
    );
  });

  it("Browsers ready!", function () {
    var tests = [],
      i = 0;
    new panic.ClientList([again.alice, again.bob]).each(function (client, id) {
      tests.push(
        client.run(
          function (test) {
            window.ENV = test.props;
            // NOTE: WE DO NOT CLEAR localStorage!
          },
          { i: (i += 1), config: config },
        ),
      );
    });
    return Promise.all(tests);
  });

  it("Alice re-initialized zen!", function () {
    return again.alice.run(function (test) {
      var env = window.ENV;
      var zen = Zen({
        peers: [
          "http://" + env.config.IP + ":" + (env.config.port + 2) + "/zen",
        ],
        file: "alicedata",
      });
      window.ref = zen.get("holy").get("grail");
    });
  });

  it("Bob re-initialized zen!", function () {
    return again.bob.run(function (test) {
      var env = window.ENV;
      var zen = Zen({
        peers: [
          "http://" + env.config.IP + ":" + (env.config.port + 2) + "/zen",
        ],
        file: "bobdata",
      });
      window.ref = zen.get("holy").get("grail");
    });
  });

  it("Alice conflict.", function () {
    return again.alice.run(function (test) {
      test.async();
      ref.on(function (data) {
        console.log("======", data);
        window.stay = data;
        if ("Bob" == data) {
          setTimeout(function () {
            if (window.ALICE) {
              return;
            }
            window.ALICE = true;
            test.done();
          }, 1000);
        }
      });
    });
  });

  it("Bob converged.", function () {
    return again.bob.run(function (test) {
      test.async();
      ref.on(function (data) {
        console.log("======", data);
        window.stay = data;
        if ("Bob" != data) {
          test.fail("wrong local value!");
          return;
        }
        setTimeout(function () {
          if (window.BOB) {
            return;
          }
          window.BOB = true;
          test.done();
        }, 1000);
      });
    });
  });

  it("Alice converged.", function () {
    return again.alice.run(function (test) {
      //console.log(stay);return;
      if ("Bob" != stay) {
        test.fail("wrong local value!");
      }
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
