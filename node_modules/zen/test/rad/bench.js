import ZEN from "../../zen.js";
import radisk from "../../lib/radisk.js";
import rfs from "../../lib/rfs.js";
var Zen = typeof window !== "undefined" ? window.Zen : ZEN;
var Radisk = (Zen.window && window.Radisk) || radisk;
Zen.TESTING = true;
try {
  localStorage.clear();
} catch (e) {}
try {
  indexedDB.deleteDatabase("radatatest");
} catch (e) {}
try {
  indexedDB.deleteDatabase("radata");
} catch (e) {}

var opt = { localStorage: false };
//opt.chunk = 1024;
opt.store = (Zen.window && window.RindexedDB(opt)) || rfs(opt);
var rad = Radisk(opt);
var zen = Zen("http://localhost:8420/zen");

Zen.window &&
  (wait.onchange = function () {
    spam.wait = this.value;
  });
Zen.window &&
  (burst.onchange = function () {
    spam.burst = this.value;
  });
//setTimeout(spam, 1);
function spam() {
  //spam.max = 100000; spam.left = spam.max; spam.wait = 1; spam.burst = 250; spam.c = 0; spam.s = (+new Date);
  //spam.max = 1000000; spam.left = spam.max; spam.wait = 0; spam.burst = 100; spam.c = 0; spam.s = (+new Date);
  //spam.max = 300000; spam.left = spam.max; spam.wait = 1; spam.burst = 5; spam.c = 0; spam.s = (+new Date);
  //spam.max = 100000; spam.left = spam.max; spam.wait = 0; spam.burst = 2; spam.c = 0; spam.s = (+new Date);
  //spam.max = 100000; spam.left = spam.max; spam.wait = 20; spam.burst = 2; spam.c = 0; spam.s = (+new Date);
  //spam.max = 100; spam.left = spam.max; spam.wait = 1; spam.burst = 1; spam.c = 0; spam.s = (+new Date);
  spam.max = 100000;
  spam.left = spam.max;
  spam.wait = 100;
  spam.burst = 100;
  spam.c = 99;
  spam.s = +new Date();
  var S = +new Date(),
    slow = 0;
  console.only.i = 1;
  var to = setTimeout(function gap() {
    if (spam.c >= spam.max) {
      clearTimeout(to);
      return;
    }
    setTimeout(gap, Math.random() * 100);
    var b = spam.burst;
    b = Math.ceil(Math.random() * b);
    //console.log('spam', +new Date - S, spam.c); S = +new Date;
    if (!b) {
      b = burst = 1;
    }
    while (b--) {
      go(++spam.c);
    }
    function go(i) {
      var d = 0,
        s = +new Date();
      i = Math.random().toString(32).slice(2);
      //console.log('go', spam.c, i);
      //setTimeout(function(){ var ack = {err: 0, ok: 1};
      //loc.put(i, {test: i}, function(err, ok){ var ack = {err: err, ok: ok};
      //ind.put(i, {test: i}, function(err, ok){ var ack = {err: err, ok: ok};
      //rad(i, {test: i}, function(err, ok){ var ack = {err: err, ok: ok};
      var ref = zen.get(i).put({ test: i }, function (ack) {
        var t = (+new Date() - s) / 1000;
        if (1 < t) {
          ++slow;
        }
        if (ack.err) {
          console.log(ack);
        }
        if (d++) {
          return;
        }
        if (--spam.left) {
          return;
        }
        spam.end = +new Date() - spam.s;
        console.log(
          "DONE!\n",
          spam.max,
          "in",
          spam.end / 1000,
          "seconds\n",
          Math.round(spam.max / (spam.end / 1000)),
          "per second. Slow:" + slow,
        );
        Zen.window && (document.body.style.backgroundColor = "lime");
      });
    }
  }, spam.wait);
  setInterval(function () {
    if (spam.end === true) {
      return;
    }
    if (spam.end) {
      spam.end = true;
    }
    var t = +new Date() - spam.s,
      tmp,
      sec;
    var status =
      "saved\n" +
      (tmp = spam.max - spam.left) +
      " in " +
      (sec = t / 1000) +
      " seconds\n" +
      Math.round(tmp / sec) +
      " per second";
    (Zen.window && (debugs.innerText = status)) ||
      console.log(status.replace(/\n/gi, " "));
  }, 500);
}
!Zen.window && setTimeout(spam, 1);

{
  if (!Zen.window) {
    return;
  }
  {
    var f = "index";
    indexedDB.deleteDatabase(f);
    var o = indexedDB.open(f, 1),
      ind = {},
      db;
    o.onupgradeneeded = function (eve) {
      eve.target.result.createObjectStore(f);
    };
    o.onsuccess = function () {
      db = o.result;
    };
    o.onerror = function (eve) {
      console.log(eve || 1);
    };
    ind.put = function (key, data, cb) {
      if (!db) {
        setTimeout(function () {
          ind.put(key, data, cb);
        }, 9);
        return;
      }
      var tx = db.transaction([f], "readwrite");
      var obj = tx.objectStore(f);
      var req = obj.put(data, "" + key);
      req.onsuccess =
        obj.onsuccess =
        tx.onsuccess =
          function () {
            cb(null, 1);
          };
      req.onabort =
        obj.onabort =
        tx.onabort =
          function (eve) {
            cb(eve || 2);
          };
      req.onerror =
        obj.onerror =
        tx.onerror =
          function (eve) {
            cb(eve || 3);
          };
    };
    ind.get = function (key, cb) {
      if (!db) {
        setTimeout(function () {
          ind.get(key, cb);
        }, 9);
        return;
      }
      var tx = db.transaction([f], "readwrite");
      var obj = tx.objectStore(f);
      var req = obj.get("" + key);
      req.onsuccess = function () {
        cb(null, req.result);
      };
      req.onabort = function (eve) {
        cb(eve || 4);
      };
      req.onerror = function (eve) {
        cb(eve || 5);
      };
    };
    window.ind = ind;
  }

  {
    localStorage.clear();
    var ls = localStorage,
      loc = {};
    loc.put = function (key, data, cb) {
      ls["" + key] = data;
      cb(null, 1);
    };
    loc.get = function (key, cb) {
      cb(null, ls["" + key]);
    };
    window.loc = loc;
  }
}
