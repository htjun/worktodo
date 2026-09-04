import { Icon, List } from "@raycast/api";
import { taskLifecycleActionKindForViewKind } from "./shared/application/task-lifecycle-interaction";
import type { TaskView } from "./shared/application/task-views";
import type { Project } from "./shared/domain/model";
import {
  taskViewContent as sharedTaskViewContent,
  taskViewFromKey,
  taskViewKey,
} from "./shared/presentation/task-views";
import { taskLifecycleMutationActionPresentation } from "./task-lifecycle-raycast";

export { buildTaskViewSections, initialPlacementForTaskView, taskViewKey } from "./shared/presentation/task-views";
export type { TaskListSection } from "./shared/presentation/task-views";

const VIEW_ICONS = {
  all: Icon.Folder,
  today: Icon.Calendar,
  upcoming: Icon.Calendar,
  inbox: Icon.Tray,
  completed: Icon.CheckCircle,
  trash: Icon.Trash,
  project: Icon.Folder,
} as const;

export function taskViewContent(view: TaskView, projects: readonly Project[]) {
  return {
    ...sharedTaskViewContent(view, projects),
    icon: VIEW_ICONS[view.kind],
    taskIcon: view.kind === "completed" ? Icon.CheckCircle : view.kind === "trash" ? Icon.Trash : Icon.Circle,
  };
}

export function lifecycleActionForTaskView(view: TaskView) {
  const kind = taskLifecycleActionKindForViewKind(view.kind);
  return { kind, ...taskLifecycleMutationActionPresentation(kind) };
}

export function TaskViewDropdown({
  view,
  projects,
  onChange,
}: {
  view: TaskView;
  projects: readonly Project[];
  onChange: (view: TaskView) => void;
}) {
  return (
    <List.Dropdown
      tooltip="Task View"
      value={taskViewKey(view)}
      onChange={(value) => onChange(taskViewFromKey(value, projects))}
    >
      <List.Dropdown.Section title="Views">
        <List.Dropdown.Item value="all" title="All Tasks" icon={Icon.Folder} />
        <List.Dropdown.Item value="today" title="Today" icon={Icon.Calendar} />
        <List.Dropdown.Item value="upcoming" title="Upcoming" icon={Icon.Calendar} />
        <List.Dropdown.Item value="inbox" title="Inbox" icon={Icon.Tray} />
        <List.Dropdown.Item value="completed" title="Completed" icon={Icon.CheckCircle} />
        <List.Dropdown.Item value="trash" title="Trash" icon={Icon.Trash} />
      </List.Dropdown.Section>
      {projects.map((project) => (
        <List.Dropdown.Item key={project.id} value={`project:${project.id}`} title={project.name} icon={Icon.Folder} />
      ))}
    </List.Dropdown>
  );
}
