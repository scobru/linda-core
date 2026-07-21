import Zen from "../../index.js";
import expect from "../expect.js";
import http from "http";
import "../../lib/promise.js";
let gunClient, server;

// MOVED TO ZEN!!!!!!!

describe("ZEN node client auth", () => {
  it("should  start server", (done) => {
    server = http.createServer().listen(8420, done);

    let gunConfig = {
      web: server,
    };

    Zen(gunConfig);
    gunClient = Zen({
      file: "radataclient",
      peers: ["http://localhost:8420/zen"],
    });
  });

  it("should create user", (done) => {
    gunClient.user().create("zen", "password", (res) => {
      //console.log({ res });
      expect(res.err).to.equal(undefined);
      done();
    });
  });

  it("should not create new user when exists", (done) => {
    gunClient2 = Zen({
      file: "radataclient2",
      peers: ["http://localhost:8420/zen"],
    });
    gunClient2.user().create("zen", "password", (res) => {
      expect(res.err).to.equal("User already created!");
      done();
    });
  });

  it("should auth user", (done) => {
    gunClient.user().auth("zen", "password", (res) => {
      expect(res.err).to.equal(undefined);
      done();
    });
  });

  it("should not stuck on null node", async () => {
    const r1 = await gunClient
      .user()
      //.once(console.log)
      .get("test")
      .promPut({ z: 1 });

    const r2 = await gunClient.user().get("test").promPut(null);
    const res = await gunClient.user().get("test").get("w");
  });

  after(() => {
    server.close(() => {});
    process.exit(-1);
  });
});
