import { Form, Icon } from "@raycast/api";
import type { Project, Section } from "./shared/domain/model";
import type { DueDatePreset } from "./shared/presentation/due-date";
import { placementKey } from "./shared/presentation/placement";

export function ProjectDropdown({
  projects,
  sections,
  value,
  onChange,
}: {
  projects: readonly Project[];
  sections: readonly Section[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Form.Dropdown id="placement" title="Project" value={value} onChange={onChange}>
      <Form.Dropdown.Item value="inbox" title="Inbox" icon={Icon.Tray} />
      {projects.map((project) => (
        <Form.Dropdown.Section key={project.id} title={project.name}>
          <Form.Dropdown.Item value={placementKey({ kind: "project", projectId: project.id })} title={project.name} />
          {sections
            .filter((section) => section.projectId === project.id)
            .map((section) => (
              <Form.Dropdown.Item
                key={section.id}
                value={placementKey({ kind: "section", projectId: project.id, sectionId: section.id })}
                title={section.name}
              />
            ))}
        </Form.Dropdown.Section>
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
