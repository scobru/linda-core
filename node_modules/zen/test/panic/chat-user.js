import ip from "ip";
import panicserver from "panic-server";
import fs from "fs";
import panicmanager from "panic-manager";
import ZEN from "./zen";
import nodehttp from "http";
import zenapp from "./index.js";
import openutil from "./util/open.js";
import { fileURLToPath } from "node:url";
import { dirname as dirnameOf } from "node:path";
const filemodname = fileURLToPath(import.meta.url);
const __dirname = dirnameOf(filemodname);

var config = {
  IP: ip.address(),
  port: 8420,
  servers: 1,
  browsers: 2, //3,
  each: 50000, //100000,
  size: 1,
  wait: 1,
  route: {
    "/": __dirname + "/index.html",
    "/zen.js": __dirname + "/../../zen.js",
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
    // Static server
    config.route[req.url] &&
      fs.createReadStream(config.route[req.url]).pipe(res);
  })
  .listen(config.port); // Start panic server.

var clients = panic.clients;
var manager = panicmanager();
manager.start({
  clients: Array(config.servers)
    .fill()
    .map(function (u, i) {
      // Create a bunch of servers.
      return {
        type: "node",
        port: config.port + (i + 1), // They'll need unique ports to start their servers on, if we run the test on 1 machine.
      };
    }),
  panic: "http://" + config.IP + ":" + config.port, // Auto-connect to our panic server.
});

var servers = clients.filter("Node.js");
var browsers = clients.excluding(servers);
var alice = browsers.pluck(1);
var carl = browsers.excluding(alice).pluck(1);

describe(
  "Load test " +
    config.browsers +
    " browser(s) across " +
    config.servers +
    " server(s)!",
  function () {
    this.timeout(50 * 60 * 1000);

    console.log("start", config.pair);
    // We'll have to manually launch the browsers,
    // So lets up the timeout so we have time to do that.

    it("Generate keypair", async function () {
      return (config.pair = await ZEN.pair());
    });

    it("Servers have joined!", function () {
      // Alright, lets wait until enough zen server peers are connected.
      return servers.atLeast(config.servers);
    });

    it("ZEN has spawned!", function () {
      // Once they are, we need to actually spin up the zen server.
      var tests = [],
        i = 0;
      servers.each(function (client) {
        // for each server peer, tell it to run this code:
        tests.push(
          client.run(
            function (test) {
              // NOTE: Despite the fact this LOOKS like we're in a closure...
              // it is not! This code is actually getting run
              // in a DIFFERENT machine or process!
              var env = test.props;
              // As a result, we have to manually pass it scope.
              test.async();
              // Clean up from previous test.
              try {
                fs.unlinkSync(env.i + "data.json");
              } catch (e) {}
              var server = nodehttp.createServer(function (req, res) {
                res.end("I am " + env.i + "!");
              });
              // Launch the server and start zen!
              var Zen;
              try {
                Zen = zenapp;
              } catch (e) {
                console.log(
                  "ZEN not found! You need to link ZEN to PANIC. Nesting the `zen` repo inside a `node_modules` parent folder often fixes this.",
                );
              }
              // Attach the server to zen.
              var zen = Zen({
                file: env.i + "data",
                web: server,
                axe: false,
                localStorage: false,
                radisk: false,
              });
              server.listen(env.config.port + env.i, function () {
                // This server peer is now done with the test!
                // It has successfully launched.
                test.done();
              });
            },
            { i: (i += 1), config: config },
          ),
        );
      });
      // NOW, this is very important:
      // Do not proceed to the next test until
      // every single server (in different machines/processes)
      // have ALL successfully launched.
      return Promise.all(tests);
    });

    it(config.browsers + " browser(s) have joined!", function () {
      openutil.web(
        config.browsers,
        "http://" + ("localhost" || config.IP) + ":" + config.port,
      ); //console.log("PLEASE OPEN http://"+ config.IP +":"+ config.port +" IN "+ config.browsers +" BROWSER(S)!");
      return browsers.atLeast(config.browsers);
    });

    it("Browsers load ZEN!", function () {
      //return carl.run(function(test){
      var tests = [],
        i = 0;
      browsers.each(function (client, id) {
        tests.push(
          client.run(
            function (test) {
              test.async();
              console.log("load?");
              function load(src, cb) {
                var script = document.createElement("script");
                script.onload = cb;
                script.src = src;
                document.head.appendChild(script);
              }
              load("zen.js", function () {
                test.done();
              });
            },
            { i: (i += 1), config: config },
          ),
        );
      });
      return Promise.all(tests);
      //}, config);
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
              //var zen = Zen('http://'+ env.config.IP + ':' + (env.config.port + 1) + '/zen');
              var zen = Zen({
                localStorage: false,
                radisk: false,
                peers:
                  "http://" +
                  env.config.IP +
                  ":" +
                  (env.config.port + 1) +
                  "/zen",
              });
              window.zen = zen;
              //window.ref = zen.user(env.config.pair.pub);
              window.ref = zen.get("~" + env.config.pair.pub);
            },
            { i: (i += 1), config: config },
          ),
        );
      });
      return Promise.all(tests);
    });

    it("Carl Create Chats", function () {
      return carl.run(function (test) {
        console.log("I AM CARL");
        $("body").append(
          "<div>CPU turns stacked: <u></u> <button onclick='this.innerText = Math.random();'>Can you click me?</button><input id='msg' style='width:100%;'><b></b></div>",
        );
        test.async();
        var env = test.props;
        var dam = zen.back("opt.mesh");
        dam.old = dam.say;
        dam.say = function () {};
        var rand = String.random || Zen.text.random;
        var i = test.props.each,
          chat = {},
          S = Zen.state();
        var tmp = "generating " + i + " records...";
        console.log(tmp);
        $("b").text(tmp);
        var big = rand(test.props.size || 1); //1000 * 10);
        function gen() {
          var j = 99;
          $("b").text(i + " left to generate...");
          var data = rand(100);
          while (--j && i) {
            --i;
            ref.get(i).put(rand(100) + data + big, function (ack) {
              console.log("err?", ack);
            });
            //Zen.state.ify(chat, i/*+'-'+rand(9)*/, S, rand(100) + data + big, '~'+test.config.pair.pub);
          }
          if (i === 0) {
            ref.get("1").once(function (x) {
              //zen._.graph.chat = chat;
              dam.say = dam.old;
              test.done();
              //console.log("Done!", x);
              $("b").text("");
            });
            return;
          }
          setTimeout.turn(gen);
        }
        zen.on("auth", function (ack) {
          setTimeout(gen, 9);
        });
        window.ref = zen.user().auth(env.pair);
        //window.chat = chat;
        //console.log(JSON.stringify(chat,null,2));
        setInterval(function () {
          $("u").text(setTimeout.turn.s.length);
        }, 1000);
      }, config);
    });

    it("Alice Asks for Chat", function () {
      return alice.run(function (test) {
        console.log("I AM ALICE");
        test.async();
        var i = 0,
          t = test.props.each,
          tmp;
        $("body").append(
          "<div><i></i> / " +
            t +
            ", seconds to first reply: <span></span>, CPU turns stacked: <u></u> <button onclick='this.innerText = Math.random();'>Can you click me?</button><input id='msg' style='width:100%;'><b></b></div>",
        );
        var $msg = $("#msg"),
          $i = $("i");
        var V,
          I,
          S = +new Date(),
          SS = S,
          tmp;
        ref.map().once(function (v, k) {
          (S &&
            console.log(
              "first:",
              $("span").text((tmp = (+new Date() - S) / 1000)) && tmp,
            )) ||
            (S = null);
          if (!v) {
            no_data;
          }
          V = v;
          I = ++i;
          //console.log(i, "chat:",k,v);
          if (i === t) {
            console.log(
              (tmp =
                "seconds from start to end: " +
                (tmp = (+new Date() - SS) / 1000) +
                ", roughly " +
                (t / tmp).toFixed(2) +
                "ops/sec."),
            );
            $("b").text(tmp);
            setTimeout(function () {
              test.done();
            }, 100);
          }
        });
        window.requestAnimationFrame =
          window.requestAnimationFrame || setTimeout;
        window.requestAnimationFrame(function frame() {
          window.requestAnimationFrame(frame, 16);
          $msg.val(V);
          $i.text(I);
        }, 16);
        setInterval(function () {
          $("u").text(setTimeout.turn.s.length);
        }, 1000);
      }, config);
    });

    after("Everything shut down.", function () {
      // which is to shut down all the browsers.
      openutil.cleanup() ||
        browsers.run(function () {
          setTimeout(function () {
            location.reload();
          }, 15 * 1000);
        });
      // And shut down all the servers.
      return servers.run(function () {
        process.exit();
      });
    });
  },
);
