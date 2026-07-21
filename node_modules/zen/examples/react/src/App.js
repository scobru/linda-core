import React, { Component } from "react";
import Zen from "@akaoio/zen";
import Todos from "./Todos.js";
import Chat from "./Chat.js";
import Json from "./Json.js";

class App extends Component {
  constructor() {
    super();
    this.zen = Zen(location.origin + "/zen");
  }

  render() {
    return (
      <div>
        <h1>React Examples</h1>
        <h2>Todo</h2>
        <Todos zen={this.zen} />
        <br />
        <hr />
        <h2>Chat</h2>
        <Chat zen={this.zen} />
        <br />
        <hr />
        <h2>Json</h2>
        <Json zen={this.zen} />
      </div>
    );
  }
}

export default App;
