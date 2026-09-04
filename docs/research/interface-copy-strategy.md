# Interface copy strategy

## Scope

This strategy covers visible copy in the Raycast commands, menu bar, forms, actions, alerts, empty states, and feedback. MCP tool descriptions are a technical contract and follow their own explicit, agent-facing style.

## Voice

Worktodo is direct, calm, and compact. Copy should describe the state or next action without marketing language, filler, or unnecessary references to Worktodo.

- Use one main idea per sentence.
- Prefer familiar verbs: create, open, edit, move, remove, restore, export.
- Name the object when an action could be read out of context: `Edit Task`, not `Edit`.
- Omit the object when a parent menu already names it and every child action applies to it: `Edit`, not `Edit Task`.
- Explain a destructive consequence before confirmation.

## Interface patterns

| Context                                | Pattern                                      | Example                                       |
| -------------------------------------- | -------------------------------------------- | --------------------------------------------- |
| Command, navigation, and action titles | Title Case; no ending punctuation            | `New Task`, `Move to Trash`                   |
| Action in an object submenu            | Verb without the repeated object             | `Complete`, `Open`, `Edit`                    |
| Form-opening action                    | `New` + object                               | `New Project`                                 |
| Form submission                        | Concrete verb + object                       | `Create Project`, `Save Task`                 |
| Success feedback                       | Object + past-tense verb                     | `Task created`                                |
| Failure feedback                       | `Unable to` + verb + object                  | `Unable to create task`                       |
| Search placeholder                     | Sentence case; name the searchable set       | `Search completed tasks`                      |
| Empty-state title                      | Short statement of the state                 | `No tasks yet`                                |
| Empty-state description                | One sentence with the next step or view rule | `Create a task to get started.`               |
| Confirmation title                     | Concrete destructive question                | `Remove “Planning”?`                          |
| Confirmation message                   | State the user-visible consequence           | `Tasks in this project will have no project.` |

## Terminology

- `New Task` opens the creation form. `Create Task` commits it.
- A menu under a named task uses `Complete`, `Open`, and `Edit`. A mixed action panel uses `Complete Task`, `Edit Task`, and `Move Task` to distinguish selected-task actions from app-level actions.
- `Quick Add` remains the command name; its submission action is `Create Task`.
- Tasks are moved to `Trash` because the operation is recoverable. Do not call this remove or delete.
- Projects and labels are removed because their definitions are deleted. Confirmations explain what happens to their tasks or assignments.
- Use `Export Backup` and `Restore Backup` for the backup workflow. Use `Replace Worktodo Data` only at the destructive confirmation step.
- Capitalize `Trash` as a named destination. Use lowercase for task, project, and label in sentences.

## Punctuation and ellipses

Complete sentences end with punctuation. Titles, labels, menu items, and placeholders do not.

Do not add an ellipsis to an action merely because it opens another view or asks for input. Raycast already shows the navigation transition, and applying the older macOS convention to only some actions makes the interface look inconsistent. Use an ellipsis only when displayed content has actually been truncated.
