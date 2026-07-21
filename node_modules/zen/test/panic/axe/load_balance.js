import ip from "ip";
import fs from "fs";
import panicmanager from "panic-manager";
import nodehttp from "http";
import zenapp from "./index.js";
import openutil from "../util/open.js";
import panic from "panic-server";
import { fileURLToPath } from "node:url";
import { dirname as dirnameOf } from "node:path";
const filemodname = fileURLToPath(import.meta.url);
const __dirname = dirnameOf(filemodname);

var config = {
  IP: ip.address(),
  port: 8420,
  servers: 1,
  browsers: 4,
  i: 0,
  route: {
    "/": __dirname + "/index.html",
    "/zen.js": __dirname + "/../../../zen.js",
    "/zen/lib/axe.js": __dirname + "/../../../lib/axe.js",
    "/jquery.js": __dirname + "/../../../examples/jquery.js",
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
      return { type: "node", port: config.port + (i + 1) };
    }),
  panic: "http://" + config.IP + ":" + config.port,
});

var servers = clients.filter("Node.js");
var server = servers.pluck(1);
var browsers = clients.excluding(servers);

describe("AXE Test: LOADBALANCE", function () {
  this.timeout(5 * 60 * 1000);

  it("Servers have joined!", function () {
    return servers.atLeast(config.servers);
  });

  it("ZEN started!", function () {
    return server.run(
      function (test) {
        var env = test.props;
        test.async();
        try {
          fs.unlinkSync(env.i + "dataaxe");
        } catch (e) {}
        try {
          fs.unlinkSync(env.i + 1 + "dataaxe");
        } catch (e) {}
        var port = env.config.port + env.i;
        var server = nodehttp.createServer(function (req, res) {
          res.end("I am " + env.i + "!");
        });
        var Zen = zenapp;
        //			 load('zen/axe');
        var zen = (global.zen = Zen({
          file: env.i + "dataaxe",
          web: server,
          pid: "Relay_pid",
        }));
        console.log("		 [ RELAY PID ] " + zen._.opt.pid);
        Zen.on("create", function (root) {
          this.to.next(root);
          root.on("in", function (msg) {
            console.log(
              "[ GET RELAY ]* PID:" + zen._.opt.pid + " RELAY MESSAGE: ",
              msg,
            );
            this.to.next(msg);
          });
          root.on("out", function (msg) {
            console.log("[ OUT RELAY ]* ", msg);
            this.to.next(msg);
          });
        });
        server.listen(port, function () {
          test.done();
        });
        zen.get("ref_soul").put({ hi: "value_" + String.random(3) });
      },
      { i: 1, config: config },
    );
  });

  it(config.browsers + " browser(s) have joined!", function () {
    openutil.web(config.browsers, "http://" + config.IP + ":" + config.port);
    //		 console.log("	 PLEASE OPEN http://"+ config.IP +":"+ config.port +" IN "+ config.browsers +" BROWSER(S)!");
    return browsers.atLeast(config.browsers);
  });

  it("Browsers initialized zen!", function () {
    var tests = [],
      i = 0;
    browsers.each(function (client, id) {
      tests.push(
        client.run(
          function (test) {
            localStorage.clear(); //console.log('Clear localStorage!!!');
            window.uuid = function (l) {
              return (
                new Date(Zen.state()).toISOString() +
                "/" +
                String.random(l || 3)
              );
            };
            var env = test.props;
            var opt = {
              peers: [
                "http://" +
                  env.config.IP +
                  ":" +
                  (env.config.port + 1) +
                  "/zen",
              ],
              // 				pid:'Peer_'+('0'+(env.config.i+1)).slice(-2)+'_',
              uuid,
            };

            Zen.on("create", function (root) {
              this.to.next(root);
              root.on("in", function (msg) {
                this.to.next(msg);
                if (msg.get && msg.get["#"] && msg.get["#"] !== "balance") {
                  ++zen.total_gets; /// increment each peer total `in` events
                  var hash =
                    (msg["#"] ? "_" + msg["#"] : "") + (msg["><"] ? "_O " : "");
                  zen
                    .get("balance")
                    .set(
                      zen._.opt.pid +
                        " " +
                        (msg["#"] ? "_msg_id_" + msg["#"] : ""),
                    );
                }
              });
            });
            var zen = (window.zen = Zen(opt));
            zen.total_gets = 0;
          },
          { i: (i += 1), config: config },
        ),
      );
      ++config.i;
    });
    return Promise.all(tests);
  });

  it("Peers subscribe", function () {
    var tests = [],
      i = 0;
    browsers.each(function (client, id) {
      tests.push(
        client.run(
          function (test) {
            test.async();
            function done(v, k) {
              // 					console.log('!!!!!!! Peer subscribed pid:' + zen._.opt.pid + ' msg:' + JSON.stringify({ k, v }));
              test.done();
            }
            zen.get("ref_soul").once(done);
          },
          { i: (i += 1), config: config },
        ),
      );
    });
    return Promise.all(tests);
  });

  it("Check balance!", function () {
    return server.run(function (test) {
      function onlyUnique(value, index, self) {
        return self.indexOf(value) === index;
      }
      console.log("RELAY PID:" + zen._.opt.pid);
      test.async();
      zen.get("balance").once(function (v, k) {
        var tmp = [],
          i = 0,
          participants = [],
          keys = Object.keys(v["_"]).sort();
        for (i = 0; i < keys.length; ++i) {
          participants.push(v[keys[i]]);
        }
        participants.sort();
        var pid,
          pids = Object.keys(v).sort();
        var pids_sorted = Object.keys(v["_"][">"])
          .map((soul) => v[soul].split(" ")[0])
          .filter(onlyUnique)
          .sort();
        var msgs_id = Object.keys(v["_"][">"])
          .map((soul) => v[soul].split(" ")[1])
          .filter(onlyUnique);
        var msgs_sorted_bytime = Object.keys(v["_"][">"]).sort();
        var table = {},
          msg_id,
          peer_id;

        for (i = 0; i < msgs_sorted_bytime.length; ++i) {
          tmp = v[msgs_sorted_bytime[i]].split(" ");
          peer_id = tmp[0];
          msg_id = tmp[1];
          if (!table[msg_id]) {
            table[msg_id] = [];
          }
          table[msg_id].push(peer_id);
          if (table[msg_id].length > 4) {
            console.log("Ouch!!!!", table);
            test.fail("Msg (" + msg_id + ") with more then 4 requests.");
            return;
          }
        }
        for (i = 0; i < pids_sorted.length; ++i) {
          if (typeof pids_sorted[i] !== "string") {
            continue;
          }
          pid = pids_sorted[i];
        }
        for (i = 0; i < pids.length; ++i) {
          var p1 = pids[i - 1],
            p2 = pids[i];
          if (!v[p1] || !v[p2]) {
            continue;
          }
          if ("string" !== typeof v[p1]) {
            v[p1] = "relay";
          }
          if ("string" !== typeof v[p2]) {
            v[p2] = "relay";
          }
        }
        // 				 console.log('TABLE: ', table);/// NOTE: this data have each peer_id who participant of a message delivery.
        setTimeout(test.done, 1000);
      });
    });
  });

  it("All finished!", function (done) {
    //		 browsers.each(function(client, id){ client.run(function() { console.log('TOTAL gets PID:'+zen._.opt.pid+': ', zen.total_gets); }); });
    console.log("Done! Cleaning things up...");
    setTimeout(done, 2000);
  });

  after("Everything shut down.", function () {
    openutil.cleanup() ||
      browsers.run(function () {
        setTimeout(function () {
          location.reload();
        }, 15 * 1000);
      });
    return servers.run(function () {
      process.exit();
    });
  });
});
