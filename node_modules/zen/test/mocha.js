import Mocha from "mocha";

const {
  Context,
  Hook,
  interfaces,
  reporters,
  Runnable,
  Runner,
  Suite,
  Test,
  utils,
} = Mocha;

if (typeof globalThis !== "undefined") {
  globalThis.Mocha = Mocha;
}

export {
  Context,
  Hook,
  interfaces,
  Mocha,
  reporters,
  Runnable,
  Runner,
  Suite,
  Test,
  utils,
};

export default Mocha;
