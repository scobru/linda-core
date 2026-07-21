import Zen from "../../index.js";
var location = { host: "localhost" };
var zen = Zen({
  file: "read.json",
  peers: ["http://" + location.host + ":8420/zen"],
});

zen
  .get("data")
  .path("stuff")
  .map(function (val, field) {
    console.log(field, "=", val);
  });

console.log("done... wait forever?");
