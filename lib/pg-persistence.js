const { user } = require('pg/lib/defaults');
const { dbQuery } = require('./db-query');
const bcrypt = require('bcrypt');

module.exports = class PgPersistence {
  constructor(session) {
    this.username = session.username;
  }

  _partitionTodoLists(todoLists) {
    let undone = [];
    let done = [];

    todoLists.forEach(todoList => {
      if (this.isDoneTodoList(todoList)) {
        done.push(todoList);
      } else {
        undone.push(todoList);
      }
    });

    return undone.concat(done);
  }

  isDoneTodoList(todoList) {
    return todoList.todos.length > 0 && todoList.todos.every(todo => todo.done);
  }

  // // Return the list of todo lists sorted by completion status and title (case-
  // // insensitive).
  async sortedTodoLists() {
    const ALL_TODOLISTS = "SELECT * FROM todolists" +
                          "  WHERE username = $1" +
                          "  ORDER BY lower(title) ASC";
    const ALL_TODOS =     "SELECT * FROM todos" +
                          "  WHERE username = $1";

    let resultTodoLists = dbQuery(ALL_TODOLISTS, this.username);
    let resultTodos = dbQuery(ALL_TODOS, this.username);
    let resultBoth = await Promise.all([resultTodoLists, resultTodos]);

    let allTodoLists = resultBoth[0].rows;
    let allTodos = resultBoth[1].rows;
    if (!allTodoLists || !allTodos) return undefined;

    allTodoLists.forEach(todoList => {
      todoList.todos = allTodos.filter(todo => {
        return todoList.id === todo.todolist_id;
      });
    });

    return this._partitionTodoLists(allTodoLists);
  }

  // // Returns a copy of the list of todos in the indicated todo list by sorted by
  // // completion status and title (case-insensitive).
  async sortedTodos(list) {
    const TODOS_SORTED = `SELECT * FROM todos WHERE username = $1 AND todolist_id = $2 
    ORDER BY done ASC, lower(title) ASC`;

    let result = await dbQuery(TODOS_SORTED, this.username, list.id);

    return result.rows;
  }

  async loadTodoList(id) {
    const FIND_TODOLIST = "SELECT * FROM todolists WHERE username = $1 AND id = $2"
    const FIND_TODOS = "SELECT * FROM todos WHERE username = $1 AND todolist_id = $2";

    let listResult = await dbQuery(FIND_TODOLIST, this.username, id);
    let todoResult = await dbQuery(FIND_TODOS, this.username, id);
    let results = await Promise.all([listResult, todoResult]);

    let todoList = results[0].rows[0];
    if (!todoList) return undefined;

    todoList.todos = results[1].rows;
    return todoList;
  }

  async loadTodo(listID, todoID) {
    let todoList = await this.loadTodoList(listID);
    let todo = todoList.todos.find(todo => todo.id === todoID);

    if (!todo) return undefined;

    return todo;
  }

  async toggleTodo(listID, todoID) {
    const TOGGLE_DONE = `UPDATE todos SET done = NOT done
    WHERE username = $1 AND todolist_id = $2 AND id = $3`;

    await dbQuery(TOGGLE_DONE, this.username, listID, todoID);
  }

  async deleteTodo(listID, todoID) {
    const DELETE_TODO = "DELETE FROM todos WHERE username = $1 AND " +
                        "todolist_id = $2 AND id = $3";

    await dbQuery(DELETE_TODO, this.username, listID, todoID);
  }

  async deleteTodoList(listID) {
    const DELETE_LIST = `DELETE FROM todolists WHERE username = $1 AND id = $2`;

    await dbQuery(DELETE_LIST, this.username, listID);
  }

  async markAllDone(listID) {
    const MARK_ALL_DONE = "UPDATE todos SET done = true WHERE " + 
                          "username = $1 AND todolist_id = $2";

    await dbQuery(MARK_ALL_DONE, this.username, listID);
  }

  async add(listID, todoTitle) {
    const ADD_TODO = `INSERT INTO todos (title, todolist_id, username)
    VALUES ($1, $2, $3)`;

    await dbQuery(ADD_TODO, todoTitle, listID, this.username);
  }

  async newTodoList(title) {
    const NEW_LIST = "INSERT INTO todolists (title, username) VALUES ($1, $2)";

    try {
      let result = dbQuery(NEW_LIST, title, this.username);
      return result.rowCount > 0;
    } catch (error) {
      if (this.isUniqueConstraintViolation(error)) return false;
      throw error;
    }
  }

  async setTitle(listID, listTitle) {
    const EDIT_LIST_TITLE = "UPDATE todolists SET title = $1 WHERE " +
                            "username = $2 AND id = $3";

    await dbQuery(EDIT_LIST_TITLE, listTitle, this.username, listID);
  }

  async searchTitle(title) {
    const FIND_LIST_NAME = `SELECT * FROM todolists WHERE username = $1 AND title = $2`;

    let result = await dbQuery(FIND_LIST_NAME, this.username, title);

    return (result.rowCount > 0);
  }

  isUniqueConstraintViolation(error) {
    return /duplicate key value violates unique constraint/.test(String(error));
  }

  async signInCheck(username, password) {
    const FIND_HASHED_PWORD = `SELECT password FROM users WHERE username = $1`;

    let result = await dbQuery(FIND_HASHED_PWORD, username);
    if (result.rowCount === 0) return false;

    return bcrypt.compare(password, result.rows[0].password);
  }
};