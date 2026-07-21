import __index from "./index.js";
define(function (require, exports, module) {
  var Zen = __index;

  var zen = new ZEN();

  zen
    .get("hello")
    .get("world")
    .put("from zen")
    .on((data, key) => console.log(data, key));
});
