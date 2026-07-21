import Zen from "../../index.js";
var location = { host: "localhost" };
var zen = Zen({
  file: "write.json",
  peers: ["http://" + location.host + ":8420/zen"],
});

zen
  .get("data")
  .path("stuff")
  .put({ a: { data: 1 }, b: { data: 2 } });
