const config = require('./lib/config');
const express = require("express");
const morgan = require("morgan");
const flash = require("express-flash");
const session = require("express-session");
const { body, validationResult } = require("express-validator");
const store = require("connect-loki");
const PgPersistence = require("./lib/pg-persistence");
const catchError = require("./lib/catch-error");

const app = express();
const host = config.HOST;
const port = config.PORT;
const LokiStore = store(session);

app.set("views", "./views");
app.set("view engine", "pug");

app.use(morgan("common"));
app.use(express.static("public"));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  cookie: {
    httpOnly: true,
    maxAge: 31 * 24 * 60 * 60 * 1000, // 31 days in millseconds
    path: "/",
    secure: false,
  },
  name: "launch-school-todos-session-id",
  resave: false,
  saveUninitialized: true,
  secret: config.SECRET,
  store: new LokiStore({}),
}));

app.use(flash());

// Create a new datastore
app.use((req, res, next) => {
  res.locals.store = new PgPersistence(req.session);
  next();
});

// Extract session info
app.use((req, res, next) => {
  res.locals.username = req.session.username;
  res.locals.signedIn = req.session.signedIn;
  res.locals.flash = req.session.flash;
  delete req.session.flash;
  next();
});

const requiresAuthentication = (req, res, next) => {
  if (!res.locals.signedIn) {
    res.redirect(302, "./users/signin");
  } else {
    next();
  }
}

// Redirect start page
app.get("/", (req, res) => {
  res.redirect("/lists");
});

// Render the list of todo lists
app.get("/lists",
  requiresAuthentication,
  catchError(async (req, res) => {
    let store = res.locals.store;
    let todoLists = await store.sortedTodoLists();
    let todosInfo = todoLists.map(todoList => ({
      countAllTodos: todoList.todos.length,
      countDoneTodos: todoList.todos.filter(todo => todo.done).length,
      isDone: store.isDoneTodoList(todoList),
    }));

    res.render("lists", {
      todoLists,
      todosInfo,
    });
  })
);

app.get("/users/signin", (req, res) => {
  req.flash("info", "Please sign in.");
  res.render("signin", {
    flash: req.flash(),
  });
});

app.post("/users/signin", async (req, res) => {
  let username = req.body.username.trim();
  let password = req.body.password;

  let authenticated = await res.locals.store.signInCheck(username, password);
  if (!authenticated) {
    req.flash("error", "Invalid credentials.");
    res.render("signin", {
      flash: req.flash(),
      username: username,
    });
  } else {
    req.session.username = username;
    req.session.signedIn = true;
    req.flash("info", "Welcome!");
    res.redirect("/lists");
  }
});

app.post("/users/signout", (req, res) => {
  delete req.session.username;
  delete req.session.signedIn;
  res.redirect("/users/signin");
})

// Render new todo list page
app.get("/lists/new", 
  requiresAuthentication,
  (req, res) => {
    res.render("new-list");
  }
);

// Create a new todo list
app.post("/lists",
  requiresAuthentication,
  [
    body("todoListTitle")
      .trim()
      .isLength({ min: 1 })
      .withMessage("The list title is required.")
      .isLength({ max: 100 })
      .withMessage("List title must be between 1 and 100 characters."),
  ],
  async (req, res) => {
    let listTitle = req.body.todoListTitle
    let store = res.locals.store;
    let errors = validationResult(req);

    const rerenderNewList = () => {
      res.render("new-list", {
        flash: req.flash(),
        todoListTitle: listTitle,
      });
    };
    
    if (!errors.isEmpty()) {
      errors.array().forEach(message => req.flash("error", message.msg));
      rerenderNewList();
    } else if (await store.searchTitle(listTitle)) {
      req.flash("error", "List title must be unique.");
      rerenderNewList();
    } else {
      let created = store.newTodoList(listTitle);
      if (!created) {
        req.flash("error", "List title must be unique.");
        rerenderNewList();
      } else {
        req.flash("success", "The todo list has been created.");
        res.redirect("/lists");
      }
    }
  }
);

// Render individual todo list and its todos
app.get("/lists/:todoListId", 
  requiresAuthentication,
  catchError(async (req, res) => {
    let todoListId = req.params.todoListId;
    let todoList = await res.locals.store.loadTodoList(+todoListId);
    if (todoList === undefined) throw new Error("Not found.");

    todoList.todos = await res.locals.store.sortedTodos(todoList);

    res.render("list", {
      todoList: todoList,
      todoListDone: res.locals.store.isDoneTodoList(todoList),
      todoListSize: todoList.todos.length,
    });
  })
);

// Toggle completion status of a todo
app.post("/lists/:todoListId/todos/:todoId/toggle",
  requiresAuthentication,
  catchError(async (req, res) => {
    let { todoListId, todoId } = { ...req.params };
    let todo = await res.locals.store.loadTodo(+todoListId, +todoId);

    if (!todo) throw new Error("Not Found.");

    let title = todo.title;
    if (todo.done) {
      res.locals.store.toggleTodo(+todoListId, +todoId);
      req.flash("success", `"${title}" marked as NOT done!`);
    } else {
      res.locals.store.toggleTodo(+todoListId, +todoId);
      req.flash("success", `"${title}" marked done.`);
    }

    res.redirect(`/lists/${todoListId}`);
  })
);

// Delete a todo
app.post("/lists/:todoListId/todos/:todoId/destroy",
  requiresAuthentication,
  catchError(async (req, res) => {
    let { todoListId, todoId } = { ...req.params };
    let todoList = await res.locals.store.loadTodoList(+todoListId);
    if (!todoList) throw new Error("Not found.");

    let todo = await res.locals.store.loadTodo(+todoListId, +todoId);
    if (!todo) throw new Error("Not found.");

    res.locals.store.deleteTodo(+todoListId, +todoId);
    req.flash("success", "The todo has been deleted.");
    res.redirect(`/lists/${todoListId}`);  
  })
);

// Mark all todos as done
app.post("/lists/:todoListId/complete_all", 
  requiresAuthentication,
  catchError(async (req, res) => {
    let todoListId = req.params.todoListId;
    let todoList = await res.locals.store.loadTodoList(+todoListId);
    if (!todoList) throw new Error("Not found.");

    res.locals.store.markAllDone(+todoListId)
    req.flash("success", "All todos have been marked as done.");
    res.redirect(`/lists/${todoListId}`);
  })
);

// Create a new todo and add it to the specified list
app.post("/lists/:todoListId/todos",
  requiresAuthentication,
  [
    body("todoTitle")
      .trim()
      .isLength({ min: 1 })
      .withMessage("The todo title is required.")
      .isLength({ max: 100 })
      .withMessage("Todo title must be between 1 and 100 characters."),
  ],
  catchError(async (req, res) => {
    let todoListId = req.params.todoListId;
    let todoList = await res.locals.store.loadTodoList(+todoListId);
    if (!todoList) throw new Error("Not found.");

    let errors = validationResult(req);
    if (!errors.isEmpty()) {
      errors.array().forEach(message => req.flash("error", message.msg));

      res.render("list", {
        flash: req.flash(),
        todoList: todoList,
        todoTitle: req.body.todoTitle,
        todoListDone: await res.locals.store.isDoneTodoList(todoList),
        todoListSize: todoList.todos.length,
      });
    } else {
      let todoTitle = req.body.todoTitle;
      res.locals.store.add(+todoListId, todoTitle);
      req.flash("success", "The todo has been created.");
      res.redirect(`/lists/${todoListId}`);
    }
  })
);

// Render edit todo list form
app.get("/lists/:todoListId/edit", 
  requiresAuthentication,
  catchError(async (req, res) => {
    let todoListId = req.params.todoListId;
    let todoList = await res.locals.store.loadTodoList(+todoListId);
    if (!todoList) throw new Error("Not found.");

    res.render("edit-list", { todoList });
  })
);

// Delete todo list
app.post("/lists/:todoListId/destroy", 
  requiresAuthentication,
  catchError(async (req, res) => {
    let todoListId = +req.params.todoListId;
    let todoList = res.locals.store.loadTodoList(+todoListId);
    if (!todoList) throw new Error("Not found.");

    res.locals.store.deleteTodoList(+todoListId);
    req.flash("success", "Todo list deleted.");
    res.redirect("/lists");
  })
)

// Edit todo list title
app.post("/lists/:todoListId/edit",
  requiresAuthentication,
  [
    body("todoListTitle")
      .trim()
      .isLength({ min: 1 })
      .withMessage("The list title is required.")
      .isLength({ max: 100 })
      .withMessage("List title must be between 1 and 100 characters."),
  ],
  catchError(async (req, res) => {
    let store = res.locals.store;
    let todoListId = req.params.todoListId;
    let listTitle = req.body.todoListTitle;

    const rerenderEditList = async () => {
      let todoList = await store.loadTodoList(+todoListId);
      if (!todoList) throw new Error("Not found.");

      res.render("edit-list", {
        flash: req.flash(),
        todoListTitle: listTitle,
        todoList: todoList,
      });
    };

    try {
      let errors = validationResult(req);
      if (!errors.isEmpty()) {
        errors.array().forEach(message => req.flash("error", message.msg));
        rerenderEditList();
      } else if (await store.searchTitle(listTitle)) {
        req.flash("error", "List title must be unique.");
        rerenderEditList();
      } else {
        res.locals.store.setTitle(+todoListId, listTitle);
        req.flash("success", "Todo list updated.");
        res.redirect(`/lists/${todoListId}`);
      }
    } catch (error) {
      if (store.isUniqueConstraintViolation(error)) {
        req.flash("error", "List title must be unique.");
        rerenderEditList();
      } else {
        throw error;
      }
    }
  })
);

// Error handler
app.use((err, req, res, _next) => {
  console.log(err); // Writes more extensive information to the console log
  res.status(404).send(err.message);
});

// Listener
app.listen(port, host, () => {
  console.log(`Todos is listening on port ${port} of ${host}!`);
});
