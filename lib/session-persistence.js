const SeedData = require("./seed-data");
const deepCopy = require("./deep-copy");
const nextID = require("./next-id");
const { sortTodoLists, sortTodos } = require("./sort");

module.exports = class SessionPersistence {
  constructor(session) {
    this._todoLists = session.todoLists || deepCopy(SeedData);
    session.todoLists = this._todoLists;
  }

  _findTodoList(listID) {
    return this._todoLists.find(list => list.id === listID);
  }

  _findTodo(listID, todoID) {
    let todoList = this._findTodoList(listID);
    if (!todoList) return undefined;

    return todoList.todos.find(todo => todo.id === todoID);
  }

  isDoneTodoList(todoList) {
    return todoList.todos.length > 0 && todoList.todos.every(todo => todo.done);
  }

  // Return the list of todo lists sorted by completion status and title (case-
  // insensitive).
  sortedTodoLists() {
    let todoLists = deepCopy(this._todoLists);
    let undone = todoLists.filter(todoList => !this.isDoneTodoList(todoList));
    let done = todoLists.filter(todoList => this.isDoneTodoList(todoList));
    return sortTodoLists(undone, done);
  }

  // Returns a copy of the list of todos in the indicated todo list by sorted by
  // completion status and title (case-insensitive).
  sortedTodos(list) {
    let undone = list.todos.filter(todo => !todo.done);
    let done = list.todos.filter(todo => todo.done);
    return deepCopy(sortTodos(undone, done));
  }

  loadTodoList(id) {
    let todoList = this._findTodoList(id);
    return deepCopy(todoList);
  }

  loadTodo(listID, todoID) {
    let todo = this._findTodo(listID, todoID);

    return deepCopy(todo);
  }

  toggleTodo(listID, todoID) {
    let todo = this._findTodo(listID, todoID);

    todo.done = !todo.done;
  }

  deleteTodo(listID, todoID) {
    let todoList = this._findTodoList(listID);
    let idx = todoList.todos.findIndex(todo => todo.id === todoID);
    todoList.todos.splice(idx, 1);
  }

  deleteTodoList(listID) {
    let idx = this._todoLists.findIndex(list => list.id === listID);
    this._todoLists.splice(idx, 1);
  }

  markAllDone(listID) {
    let todoList = this._findTodoList(listID);
    todoList.todos.forEach(todo => todo.done = true);
  }

  add(listID, todoTitle) {
    let todoList = this._findTodoList(listID);
    let newTodo = {
      id: nextID(),
      title: todoTitle,
      done: false,
    }

    todoList.todos.push(newTodo);
  }

  newTodoList(title) {
    let todoList = {
      id: nextID(),
      title: title,
      todos: [],
    }

    this._todoLists.push(todoList);

    return true;
  }

  setTitle(listID, listTitle) {
    let todoList = this._findTodoList(listID);
    todoList.title = listTitle;
  }

  searchTitle(title) {
    return this._todoLists.some(list => list.title === title);
  }

  isUniqueConstraintViolation(_error) {
    return false;
  }
};