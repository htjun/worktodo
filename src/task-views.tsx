import { Icon, List } from "@raycast/api";
import type { Project, Section } from "./shared/domain/model";
import type { TaskService } from "./shared/domain/task-service";
import {
  lifecycleActionForTaskView as sharedLifecycleActionForTaskView,
  taskViewContent as sharedTaskViewContent,
  taskViewFromKey,
  taskViewKey,
  type TaskView,
} from "./shared/presentation/task-views";

export {
  initialPlacementForTaskView,
  loadTaskViewSections,
  normalizeTaskView,
  taskViewKey,
} from "./shared/presentation/task-views";
export type { TaskListSection, TaskView } from "./shared/presentation/task-views";

const VIEW_ICONS = {
  all: Icon.Folder,
  today: Icon.Calendar,
  upcoming: Icon.Calendar,
  inbox: Icon.Tray,
  completed: Icon.CheckCircle,
  trash: Icon.Trash,
  project: Icon.Folder,
  section: Icon.BulletPoints,
} as const;

export function taskViewContent(view: TaskView, projects: readonly Project[], sections: readonly Section[]) {
  return {
    ...sharedTaskViewContent(view, projects, sections),
    icon: VIEW_ICONS[view.kind],
    taskIcon: view.kind === "completed" ? Icon.CheckCircle : view.kind === "trash" ? Icon.Trash : Icon.Circle,
  };
}

export function lifecycleActionForTaskView(view: TaskView, service: TaskService, taskId: string) {
  const action = sharedLifecycleActionForTaskView(view, service, taskId);
  return {
    ...action,
    icon:
      action.kind === "restore"
        ? Icon.ArrowCounterClockwise
        : action.kind === "reopen"
          ? Icon.Circle
          : Icon.CheckCircle,
  };
}

export function TaskViewDropdown({
  view,
  projects,
  sections,
  onChange,
}: {
  view: TaskView;
  projects: readonly Project[];
  sections: readonly Section[];
  onChange: (view: TaskView) => void;
}) {
  return (
    <List.Dropdown
      tooltip="Task View"
      value={taskViewKey(view)}
      onChange={(value) => onChange(taskViewFromKey(value, projects, sections))}
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
        <List.Dropdown.Section key={project.id} title={project.name}>
          <List.Dropdown.Item value={`project:${project.id}`} title="All Tasks" icon={Icon.Folder} />
          {sections
            .filter((section) => section.projectId === project.id)
            .map((section) => (
              <List.Dropdown.Item
                key={section.id}
                value={`section:${section.id}`}
                title={section.name}
                icon={Icon.BulletPoints}
              />
            ))}
        </List.Dropdown.Section>
      ))}
    </List.Dropdown>
  );
}
