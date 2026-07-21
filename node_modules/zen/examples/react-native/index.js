/** @format */
import "./shim.js";
import { AppRegistry } from "react-native";
import App from "./src/App/index.js";
import { name as appName } from "./app.json";

AppRegistry.registerComponent(appName, () => App);
console.disableYellowBox = true;
