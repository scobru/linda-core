import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import zenbase from "../zen.js";
var ZEN;
{
  var W = function (o) {
    return new zenbase(o);
  };
  Object.setPrototypeOf(W, zenbase);
  W.prototype = zenbase.prototype;
  Object.defineProperty(W.prototype, "_", {
    get: function () {
      return this._graph._;
    },
    configurable: true,
  });
  ZEN = W;
}
var Zen = ZEN;
import "../lib/file.js";
import serve from "../lib/server.js";

if (process.env.ZEN) {
  Zen.ZEN = ZEN;
}

const myDir = dirname(fileURLToPath(import.meta.url));

export default serve(Zen, myDir);
