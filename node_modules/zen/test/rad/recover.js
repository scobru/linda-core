import zenbase from "../../zen.js";
import "../../lib/store.js";
import "../../lib/rfs.js";
import fs from "fs";
import fsrm from "../../lib/fsrm.js";
var ZEN;
{
  var W = function (o) {
    return new zenbase(o);
  };
  Object.setPrototypeOf(W, zenbase);
  W.prototype = zenbase.prototype;
  ZEN = W;
}
import xpect from "../expect.js";
import radisk from "../../lib/radisk.js";
import rfs from "../../lib/rfs.js";
var root;
var Zen;
{
  var env;
  if (typeof global !== "undefined") {
    env = global;
  }
  if (typeof window !== "undefined") {
    env = window;
  }
  root = env.window ? env.window : global;
  try {
    env.window && root.localStorage && root.localStorage.clear();
  } catch (e) {}
  try {
    indexedDB.deleteDatabase("radatatest");
  } catch (e) {}
  if (root.Zen) {
    root.Zen = root.Zen;
    root.Zen.TESTING = true;
  } else {
    try {
      fs.unlinkSync("tmp/data.json");
    } catch (e) {}
    try {
      fsrm("tmp/radatatest");
    } catch (e) {}
    root.Zen = ZEN;
    root.Zen.TESTING = true;
  }

  try {
    var expect = (global.expect = xpect);
  } catch (e) {}
}
this;

{
  Zen = root.Zen;

  if (Zen.window && !Zen.window.RindexedDB) {
    return;
  }

  var opt = {};
  opt.file = "radatatest";
  var Radisk = (Zen.window && Zen.window.Radisk) || radisk;
  opt.store = ((Zen.window && Zen.window.RindexedDB) || rfs)(opt);
  opt.chunk = 170;
  var Radix = Radisk.Radix;
  var rad = Radisk(opt),
    esc = String.fromCharCode(27);

  describe("RAD Crashes", function () {
    describe("If No File Added to Index, Recover", function () {
      var zen = Zen({ chunk: opt.chunk });

      it("write initial", function (done) {
        var all = {},
          to,
          start,
          tmp;
        var names = ["al", "alex", "alexander", "alice"];
        names.forEach(function (v, i) {
          all[++i] = true;
          tmp = v.toLowerCase();
          zen
            .get("names")
            .get(tmp)
            .put(i, function (ack) {
              expect(ack.err).to.not.be.ok();
              delete all[i];
              if (!Zen.obj.empty(all)) {
                return;
              }
              done();
            });
        });
      });

      it("write alan", function (done) {
        var all = {},
          to,
          start,
          tmp;
        var names = ["alan"];
        console.log(
          "DID YOU ADD `Zen.CRASH` != 1%C to Radisk f.write list.add callback?",
        );
        Zen.CRASH = true; // add check for this in f.swap!
        names.forEach(function (v, i) {
          all[++i] = true;
          tmp = v.toLowerCase();
          zen.get("names").get(tmp).put(i);
        });
        setTimeout(function () {
          Zen.CRASH = false;
          done();
        }, 1000);
      });

      it("write zach", function (done) {
        zen
          .get("names")
          .get("zach")
          .put(9, function (ack) {
            expect(ack.err).to.not.be.ok();
            done();
          });
      });

      it("read names", function (done) {
        console.log(
          "Better to .skip 1st run, .only 2nd run & prevent clearing radatatest.",
        );
        var g = Zen();
        var all = { al: 1, alex: 2, alexander: 3, alice: 4, zach: 9 };
        //g.get('names').get('zach').put(9, function(ack){ done() }); return;
        g.get("names")
          .map()
          .on(function (v, k) {
            //console.log("DATA:", k, v);
            if (all[k] === v) {
              delete all[k];
            }
            if (!Zen.obj.empty(all)) {
              return;
            }
            done();
          });
      });
    });
  });
}
