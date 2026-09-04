import { Form, Icon } from "@raycast/api";
import { taskEditingPlacementKey, type DueDatePreset } from "./shared/application/task-editing";
import type { Project } from "./shared/domain/model";

export function ProjectDropdown({
  projects,
  value,
  error,
  onChange,
}: {
  projects: readonly Project[];
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <Form.Dropdown id="placement" title="Project" value={value} error={error} onChange={onChange}>
      <Form.Dropdown.Item value="inbox" title="Inbox" icon={Icon.Tray} />
      {projects.map((project) => (
        <Form.Dropdown.Item
          key={project.id}
          value={taskEditingPlacementKey({ kind: "project", projectId: project.id })}
          title={project.name}
          icon={Icon.Folder}
        />
      ))}
    </Form.Dropdown>
  );
}

export function DueDateFields({
  preset,
  customDate,
  error,
  onPresetChange,
  onCustomDateChange,
}: {
  preset: DueDatePreset;
  customDate: Date | null;
  error?: string;
  onPresetChange: (preset: DueDatePreset) => void;
  onCustomDateChange: (date: Date | null) => void;
}) {
  return (
    <>
      <Form.Dropdown
        id="dueDatePreset"
        title="Due Date"
        value={preset}
        onChange={(value) => onPresetChange(value as DueDatePreset)}
      >
        <Form.Dropdown.Item value="none" title="No Due Date" />
        <Form.Dropdown.Item value="today" title="Today" />
        <Form.Dropdown.Item value="tomorrow" title="Tomorrow" />
        <Form.Dropdown.Item value="endOfWeek" title="End of This Week" />
        <Form.Dropdown.Item value="custom" title="Custom" />
      </Form.Dropdown>
      {preset === "custom" ? (
        <Form.DatePicker
          id="customDueDate"
          title="Custom Date"
          type={Form.DatePicker.Type.Date}
          value={customDate}
          error={error}
          onChange={onCustomDateChange}
        />
      ) : null}
    </>
  );
}
