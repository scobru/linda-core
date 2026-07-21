/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 * @flow
 */

import React, { Component } from "react";
import { View } from "react-native";

import { Demo } from "./Demo.js";

import PolyFillCrypto from "./PolyFillCrypto.js";

export class App extends Component {
  render() {
    return (
      <View>
        <PolyFillCrypto />
        <Demo />
      </View>
    );
  }
}
