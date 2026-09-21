import { closeMainWindow, Form, PopToRootType } from "@raycast/api";
import { useState } from "react";
import { requestMenuBarRefresh } from "./raycast-commands";
import { createOperationScopedTaskEditingMutations } from "./shared/application/task-editing";
import { openProductionWorktodo, type WorktodoSession } from "./shared/application/worktodo";
import type { Label, Project } from "./shared/domain/model";
import { TaskForm } from "./task-form";

type NewTaskState = {
  projects: Project[];
  labels: Label[];
  error: string | null;
};

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred";
}

export default function NewTask() {
  const [viewerTimeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [state] = useState<NewTaskState>(() => {
    let session: WorktodoSession | undefined;
    try {
      session = openProductionWorktodo();
      return {
        projects: session.service.listProjects(),
        labels: session.service.listLabels(),
        error: null,
      };
    } catch (error) {
      return { projects: [], labels: [], error: messageFrom(error) };
    } finally {
      session?.close();
    }
  });
  const [mutations] = useState(() => createOperationScopedTaskEditingMutations(openProductionWorktodo));

  if (state.error) {
    return (
      <Form navigationTitle="New task">
        <Form.Description title="Unable to open Worktodo" text={state.error} />
      </Form>
    );
  }

  return (
    <TaskForm
      mutations={mutations}
      projects={state.projects}
      labels={state.labels}
      initialProjectId={null}
      viewerTimeZone={viewerTimeZone}
      onSaved={requestMenuBarRefresh}
      onFinished={() => closeMainWindow({ clearRootSearch: true, popToRootType: PopToRootType.Immediate })}
    />
  );
}
