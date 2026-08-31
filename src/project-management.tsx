import {
  Action,
  ActionPanel,
  Alert,
  confirmAlert,
  Form,
  Icon,
  Keyboard,
  List,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { useCallback, useEffect, useState } from "react";
import {
  createProject,
  createSection,
  removeProject,
  removeSection,
  renameProject,
  renameSection,
} from "./shared/application/project-workflows";
import type { Project, Section } from "./shared/domain/model";
import type { TaskService } from "./shared/domain/task-service";

type CollectionState<T> = {
  isLoading: boolean;
  error: string | null;
  items: T[];
};

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred";
}

function NameForm({
  navigationTitle,
  fieldTitle,
  submitTitle,
  successTitle,
  initialName = "",
  save,
}: {
  navigationTitle: string;
  fieldTitle: string;
  submitTitle: string;
  successTitle: string;
  initialName?: string;
  save: (name: string) => void;
}) {
  const { pop } = useNavigation();
  const [nameError, setNameError] = useState<string>();

  async function submit(values: { name: string }): Promise<boolean> {
    setNameError(undefined);
    if (values.name.trim().length === 0) {
      setNameError(`${fieldTitle} cannot be empty`);
      return false;
    }
    try {
      save(values.name);
      await showToast(Toast.Style.Success, successTitle);
      pop();
      return true;
    } catch (error) {
      const message = messageFrom(error);
      setNameError(message);
      await showToast(Toast.Style.Failure, `Unable to save ${fieldTitle.toLowerCase()}`, message);
      return false;
    }
  }

  return (
    <Form
      navigationTitle={navigationTitle}
      actions={
        <ActionPanel>
          <Action.SubmitForm title={submitTitle} icon={Icon.Check} onSubmit={submit} />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="name"
        title={fieldTitle}
        defaultValue={initialName}
        error={nameError}
        autoFocus
        onChange={() => setNameError(undefined)}
      />
    </Form>
  );
}

function SectionsView({
  service,
  project,
  onChanged,
}: {
  service: TaskService;
  project: Project;
  onChanged: () => void;
}) {
  const [state, setState] = useState<CollectionState<Section>>({ isLoading: true, error: null, items: [] });

  const refresh = useCallback(() => {
    try {
      setState({ isLoading: false, error: null, items: service.listSections(project.id) });
    } catch (error) {
      setState({ isLoading: false, error: messageFrom(error), items: [] });
    }
  }, [project.id, service]);

  useEffect(() => refresh(), [refresh]);

  const changed = useCallback(() => {
    refresh();
    onChanged();
  }, [onChanged, refresh]);

  const createTarget = (
    <NameForm
      navigationTitle={`New Section in ${project.name}`}
      fieldTitle="Section Name"
      submitTitle="Create Section"
      successTitle="Section created"
      save={(name) => createSection(service, project.id, name, changed)}
    />
  );

  async function remove(section: Section) {
    const confirmed = await confirmAlert({
      title: `Remove “${section.name}”?`,
      message: `Tasks in this section will move directly to ${project.name}.`,
      primaryAction: { title: "Remove Section", style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) {
      return;
    }
    try {
      removeSection(service, section.id, changed);
      await showToast(Toast.Style.Success, "Section removed", `Its tasks moved to ${project.name}.`);
    } catch (error) {
      await showToast(Toast.Style.Failure, "Unable to remove section", messageFrom(error));
    }
  }

  return (
    <List
      navigationTitle={`${project.name} Sections`}
      isLoading={state.isLoading}
      searchBarPlaceholder="Search Sections"
    >
      {state.error ? (
        <List.EmptyView icon={Icon.Warning} title="Unable to load sections" description={state.error} />
      ) : state.items.length === 0 ? (
        <List.EmptyView
          icon={Icon.BulletPoints}
          title="No sections"
          description={`Create a section inside ${project.name}.`}
          actions={
            <ActionPanel>
              <Action.Push title="Create Section" icon={Icon.Plus} target={createTarget} />
            </ActionPanel>
          }
        />
      ) : (
        state.items.map((section) => (
          <List.Item
            key={section.id}
            icon={Icon.BulletPoints}
            title={section.name}
            actions={
              <ActionPanel>
                <Action.Push
                  title="Rename Section"
                  icon={Icon.Pencil}
                  shortcut={Keyboard.Shortcut.Common.Edit}
                  target={
                    <NameForm
                      navigationTitle="Rename Section"
                      fieldTitle="Section Name"
                      submitTitle="Save Section"
                      successTitle="Section renamed"
                      initialName={section.name}
                      save={(name) => renameSection(service, section.id, name, changed)}
                    />
                  }
                />
                <Action.Push
                  title="Create Section"
                  icon={Icon.Plus}
                  shortcut={Keyboard.Shortcut.Common.New}
                  target={createTarget}
                />
                <Action
                  title="Remove Section"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  shortcut={Keyboard.Shortcut.Common.Remove}
                  onAction={() => remove(section)}
                />
              </ActionPanel>
            }
          />
        ))
      )}
    </List>
  );
}

export function ProjectsView({ service, onChanged }: { service: TaskService; onChanged: () => void }) {
  const [state, setState] = useState<CollectionState<Project>>({ isLoading: true, error: null, items: [] });
  const [sections, setSections] = useState<Section[]>([]);

  const refresh = useCallback(() => {
    try {
      setState({ isLoading: false, error: null, items: service.listProjects() });
      setSections(service.listSections());
    } catch (error) {
      setState({ isLoading: false, error: messageFrom(error), items: [] });
      setSections([]);
    }
  }, [service]);

  useEffect(() => refresh(), [refresh]);

  const changed = useCallback(() => {
    refresh();
    onChanged();
  }, [onChanged, refresh]);

  const createTarget = (
    <NameForm
      navigationTitle="New Project"
      fieldTitle="Project Name"
      submitTitle="Create Project"
      successTitle="Project created"
      save={(name) => createProject(service, name, changed)}
    />
  );

  async function remove(project: Project) {
    const confirmed = await confirmAlert({
      title: `Remove “${project.name}”?`,
      message: "Its sections will be removed and all of its tasks will move to Inbox.",
      primaryAction: { title: "Remove Project", style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) {
      return;
    }
    try {
      removeProject(service, project.id, changed);
      await showToast(Toast.Style.Success, "Project removed", "Its tasks moved to Inbox.");
    } catch (error) {
      await showToast(Toast.Style.Failure, "Unable to remove project", messageFrom(error));
    }
  }

  return (
    <List navigationTitle="Projects" isLoading={state.isLoading} searchBarPlaceholder="Search Projects">
      {state.error ? (
        <List.EmptyView icon={Icon.Warning} title="Unable to load projects" description={state.error} />
      ) : state.items.length === 0 ? (
        <List.EmptyView
          icon={Icon.Folder}
          title="No projects"
          description="Create a project to organize tasks."
          actions={
            <ActionPanel>
              <Action.Push title="Create Project" icon={Icon.Plus} target={createTarget} />
            </ActionPanel>
          }
        />
      ) : (
        state.items.map((project) => {
          const sectionCount = sections.filter((section) => section.projectId === project.id).length;
          return (
            <List.Item
              key={project.id}
              icon={Icon.Folder}
              title={project.name}
              subtitle={`${sectionCount} ${sectionCount === 1 ? "section" : "sections"}`}
              actions={
                <ActionPanel>
                  <Action.Push
                    title="Manage Sections"
                    icon={Icon.BulletPoints}
                    target={<SectionsView service={service} project={project} onChanged={changed} />}
                  />
                  <Action.Push
                    title="Rename Project"
                    icon={Icon.Pencil}
                    shortcut={Keyboard.Shortcut.Common.Edit}
                    target={
                      <NameForm
                        navigationTitle="Rename Project"
                        fieldTitle="Project Name"
                        submitTitle="Save Project"
                        successTitle="Project renamed"
                        initialName={project.name}
                        save={(name) => renameProject(service, project.id, name, changed)}
                      />
                    }
                  />
                  <Action.Push
                    title="Create Project"
                    icon={Icon.Plus}
                    shortcut={Keyboard.Shortcut.Common.New}
                    target={createTarget}
                  />
                  <Action
                    title="Remove Project"
                    icon={Icon.Trash}
                    style={Action.Style.Destructive}
                    shortcut={Keyboard.Shortcut.Common.Remove}
                    onAction={() => remove(project)}
                  />
                </ActionPanel>
              }
            />
          );
        })
      )}
    </List>
  );
}
