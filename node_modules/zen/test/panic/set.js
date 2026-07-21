import ip from "ip";
import fs from "fs";
import panicmanager from "panic-manager";
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
  browsers: 2,
  route: {
    "/": __dirname + "/index.html",
    "/zen.js": __dirname + "/../../zen.js",
    "/jquery.js": __dirname + "/../../examples/jquery.js",
    "/zen.js": __dirname + "/../../zen.js",
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
var bob = browsers.excluding(alice).pluck(1);
var again = {};

describe("Make sure ZEN syncs correctly", function () {
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
        var port = env.config.port + env.i;
        var server = nodehttp.createServer(function (req, res) {
          res.end("I am " + env.i + "!");
        });
        var Zen = zenapp;
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

  it("Browsers load ZEN!", function () {
    var tests = [],
      i = 0;
    browsers.each(function (client, id) {
      tests.push(
        client.run(
          function (test) {
            test.async();
            function load(src, cb) {
              var script = document.createElement("script");
              script.onload = cb;
              script.src = src;
              document.head.appendChild(script);
            }
            test.done();
          },
          { i: (i += 1), config: config },
        ),
      );
    });
    return Promise.all(tests);
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
            window.zen = zen;
            var user = (window.user = zen.get("pub/alice"));
          },
          { i: (i += 1), config: config },
        ),
      );
    });
    return Promise.all(tests);
  });

  it("Create Alice", function () {
    return alice.run(function (test) {
      console.log("I AM ALICE");
      test.async();
      user.put({ pub: "alice" }, function (ack) {
        if (ack.err) {
          return;
        }
        console.log("write...");
        user
          .get("who")
          .get("said")
          .set(
            {
              what: "Hello world!",
            },
            function (ack) {
              if (ack.err) {
                return;
              }
              test.done();
            },
          );
      });
    });
  });

  it("Have Bob listen", function () {
    return bob.run(function (test) {
      test.async();
      window.count = [];
      user
        .get("who")
        .get("said")
        .map()
        .val(function (data) {
          console.log("read...", data);
          window.count.push(data);
          if (window.count.length - 1) {
            return;
          }
          test.done();
        });
    });
  });

  it("Alice reloading.", function () {
    return alice.run(function (test) {
      location.reload();
    });
  });

  it("Got Alice.", function () {
    again.alice = browsers
      .excluding(new panic.ClientList([alice, bob]))
      .pluck(1);
    return again.alice.atLeast(1);
  });

  it("Alice reloaded.", function () {
    return again.alice.run(
      function (test) {
        var env = test.props;
        var zen = Zen(
          "http://" + env.config.IP + ":" + (env.config.port + 1) + "/zen",
        );
        window.zen = zen;
        var user = (window.user = zen.get("pub/alice"));
      },
      { i: 1, config: config },
    );
  });

  it("Alice write.", function () {
    return again.alice.run(function (test) {
      test.async();
      console.log("write...");
      user
        .get("who")
        .get("said")
        .set(
          {
            what: "AAA",
          },
          function (ack) {
            if (ack.err) {
              return;
            }
            test.done();
          },
        );
    });
  });

  it("Bob got", function () {
    return bob.run(function (test) {
      test.async();
      console.log(window.count);
      setTimeout(function () {
        if ("AAA" === window.count[1].what) {
          test.done();
        }
      }, 100);
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
