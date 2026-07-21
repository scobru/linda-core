import path from "path";
import HtmlWebpackPlugin from "html-webpack-plugin";
import { fileURLToPath } from "node:url";
import { dirname as __dirnameOf } from "node:path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = __dirnameOf(__filename);
let plugins = [];

plugins.push(
  new HtmlWebpackPlugin({
    filename: "./index.html",
    template: "./src/index.html",
    inject: true,
    minify: false,
    hash: false,
    cache: false,
    showErrors: false,
  }),
);

console.log("webpack config loaded");

export default {
  mode: "development",

  // stats: 'minimal',
  stats: "normal",
  // stats: 'verbose',

  entry: [path.resolve(__dirname, "./src/app.js")],

  output: {
    path: path.resolve(__dirname, "./public"),
    clean: true,
    filename: "./app.js",
  },

  plugins: plugins,
};
