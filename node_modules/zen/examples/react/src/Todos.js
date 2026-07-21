import React, { Component } from "react";
import Zen from "@akaoio/zen";
// import path from 'zen/lib/path' // TODO: use zen equivalent
import "./style.css";

const formatTodos = (todos) =>
  Object.keys(todos)
    .map((key) => ({ key, val: todos[key] }))
    .filter((t) => Boolean(t.val) && t.key !== "_");

export default class Todos extends Component {
  constructor({ zen }) {
    super();
    this.zen = zen.get("todos");
    this.state = { newTodo: "", todos: [] };
  }

  componentWillMount() {
    this.zen.on((todos) =>
      this.setState({
        todos: formatTodos(todos),
      }),
    );
  }

  add = (e) => {
    e.preventDefault();
    this.zen.path(Zen.text.random()).put(this.state.newTodo);
    this.setState({ newTodo: "" });
  };

  del = (key) => this.zen.path(key).put(null);

  handleChange = (e) => this.setState({ newTodo: e.target.value });

  render() {
    return (
      <div>
        <form onSubmit={this.add}>
          <input value={this.state.newTodo} onChange={this.handleChange} />
          <button onClick={this.add}>Add</button>
        </form>
        <br />
        <ul>
          {this.state.todos.map((todo) => (
            <li key={todo.key} onClick={(_) => this.del(todo.key)}>
              {todo.val}
            </li>
          ))}
        </ul>
      </div>
    );
  }
}
