import {
  DomainError,
  placementFields,
  placementOf,
  type DueValue,
  type Placement,
  type Priority,
  type Project,
  type Section,
  type Task,
} from "./model";
import {
  queryAllTasks,
  queryCompleted,
  queryInbox,
  queryProject,
  querySection,
  queryToday,
  queryTrash,
  type TodayResult,
  queryUpcoming,
  type UpcomingResult,
} from "./queries";
import type { TaskRepository } from "./repository";
import {
  validateDueValue,
  validateId,
  validateNonNegativeInteger,
  validateNotes,
  validatePlacement,
  validatePriority,
  validateText,
} from "./validation";

const POSITION_STEP = 1_024;

type Dependencies = {
  createId: () => string;
  now: () => number;
};

type OrderedEntity = Pick<Project, "id" | "position" | "createdAtMs">;

export type CreateTaskInput = {
  title: string;
  notes?: string;
  priority?: Priority;
  placement: Placement;
  due?: DueValue;
};

export type UpdateTaskInput = {
  title?: string;
  notes?: string;
  priority?: Priority;
  due?: DueValue;
};

function compareOrdered(left: OrderedEntity, right: OrderedEntity): number {
  return (
    left.position - right.position ||
    left.createdAtMs - right.createdAtMs ||
    (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  );
}

function samePlacement(left: Placement, right: Placement): boolean {
  if (left.kind === "inbox") {
    return right.kind === "inbox";
  }
  if (left.kind === "project") {
    return right.kind === "project" && left.projectId === right.projectId;
  }
  return right.kind === "section" && left.projectId === right.projectId && left.sectionId === right.sectionId;
}

function sameDue(left: DueValue, right: DueValue): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "none") {
    return true;
  }
  if (left.kind === "allDay" && right.kind === "allDay") {
    return left.date === right.date;
  }
  return (
    left.kind === "timed" &&
    right.kind === "timed" &&
    left.instantMs === right.instantMs &&
    left.timeZone === right.timeZone
  );
}

function effectiveUpdate(previous: number, now: number): number {
  const effective = Math.max(previous + 1, now);
  if (!Number.isSafeInteger(effective)) {
    throw new DomainError("INVALID_ARGUMENT", "Updated timestamp exceeds the safe integer range");
  }
  return effective;
}

function appendPosition<T extends OrderedEntity>(items: T[], update: (item: T) => void): number {
  const maximum = items.reduce((value, item) => Math.max(value, item.position), 0);
  if (maximum <= Number.MAX_SAFE_INTEGER - POSITION_STEP) {
    return maximum + POSITION_STEP;
  }

  const ordered = [...items].sort(compareOrdered);
  ordered.forEach((item, index) => {
    const position = (index + 1) * POSITION_STEP;
    update({ ...item, position });
    item.position = position;
  });
  return (ordered.length + 1) * POSITION_STEP;
}

export class TaskService {
  constructor(
    private readonly repository: TaskRepository,
    private readonly dependencies: Dependencies,
  ) {}

  private operationTime(): number {
    return validateNonNegativeInteger(this.dependencies.now(), "Operation timestamp");
  }

  private newId(existing: (id: string) => unknown): string {
    const id = validateId(this.dependencies.createId());
    if (existing(id)) {
      throw new DomainError("INVALID_ARGUMENT", "Generated ID already exists");
    }
    return id;
  }

  private requireProject(id: string): Project {
    const project = this.repository.getProject(validateId(id));
    if (!project) {
      throw new DomainError("NOT_FOUND", "Project not found");
    }
    return project;
  }

  private requireSection(id: string): Section {
    const section = this.repository.getSection(validateId(id));
    if (!section) {
      throw new DomainError("NOT_FOUND", "Section not found");
    }
    return section;
  }

  private requireTask(id: string): Task {
    const task = this.repository.getTask(validateId(id));
    if (!task) {
      throw new DomainError("NOT_FOUND", "Task not found");
    }
    return task;
  }

  private requireActiveTask(id: string): Task {
    const task = this.requireTask(id);
    if (task.trashedAtMs !== null) {
      throw new DomainError("TASK_TRASHED", "Restore the task before changing it");
    }
    return task;
  }

  private validatedPlacement(value: Placement): Placement {
    const placement = validatePlacement(value);
    if (placement.kind === "inbox") {
      return placement;
    }
    const project = this.repository.getProject(placement.projectId);
    if (!project) {
      throw new DomainError("INVALID_PLACEMENT", "Placement project does not exist");
    }
    if (placement.kind === "section") {
      const section = this.repository.getSection(placement.sectionId);
      if (!section || section.projectId !== project.id) {
        throw new DomainError("INVALID_PLACEMENT", "Placement section does not belong to the project");
      }
    }
    return placement;
  }

  private tasksInPlacement(placement: Placement): Task[] {
    return this.repository.listTasks().filter((task) => samePlacement(placementOf(task), placement));
  }

  createProject(name: string): Project {
    const validName = validateText(name, "Project name");
    return this.repository.transaction(() => {
      const projects = this.repository.listProjects();
      const timestamp = this.operationTime();
      const position = appendPosition(projects, (project) =>
        this.repository.updateProject({
          ...project,
          updatedAtMs: effectiveUpdate(project.updatedAtMs, timestamp),
        }),
      );
      const project: Project = {
        id: this.newId((id) => this.repository.getProject(id)),
        name: validName,
        position,
        createdAtMs: timestamp,
        updatedAtMs: timestamp,
      };
      this.repository.insertProject(project);
      return project;
    });
  }

  renameProject(id: string, name: string): Project {
    const validId = validateId(id);
    const validName = validateText(name, "Project name");
    return this.repository.transaction(() => {
      const project = this.requireProject(validId);
      if (project.name === validName) {
        return project;
      }
      const updated = {
        ...project,
        name: validName,
        updatedAtMs: effectiveUpdate(project.updatedAtMs, this.operationTime()),
      };
      this.repository.updateProject(updated);
      return updated;
    });
  }

  listProjects(): Project[] {
    return this.repository.listProjects().sort(compareOrdered);
  }

  removeProject(id: string): void {
    const validId = validateId(id);
    this.repository.transaction(() => {
      const project = this.requireProject(validId);
      const sections = this.repository
        .listSections()
        .filter((section) => section.projectId === project.id)
        .sort(compareOrdered);
      const tasks = this.repository.listTasks();
      const directTasks = tasks
        .filter((task) => task.projectId === project.id && task.sectionId === null)
        .sort(compareOrdered);
      const sectionTasks = sections.flatMap((section) =>
        tasks.filter((task) => task.sectionId === section.id).sort(compareOrdered),
      );
      const inboxTasks = tasks.filter((task) => task.projectId === null && task.sectionId === null);
      const operationTime = this.operationTime();

      for (const task of [...directTasks, ...sectionTasks]) {
        const position = appendPosition(inboxTasks, (existing) =>
          this.repository.updateTask({
            ...existing,
            updatedAtMs: effectiveUpdate(existing.updatedAtMs, operationTime),
          }),
        );
        const updated = {
          ...task,
          projectId: null,
          sectionId: null,
          position,
          updatedAtMs: effectiveUpdate(task.updatedAtMs, operationTime),
        };
        this.repository.updateTask(updated);
        inboxTasks.push(updated);
      }
      sections.forEach((section) => this.repository.deleteSection(section.id));
      this.repository.deleteProject(project.id);
    });
  }

  createSection(projectId: string, name: string): Section {
    const validProjectId = validateId(projectId);
    const validName = validateText(name, "Section name");
    return this.repository.transaction(() => {
      this.requireProject(validProjectId);
      const sections = this.repository.listSections().filter((section) => section.projectId === validProjectId);
      const timestamp = this.operationTime();
      const position = appendPosition(sections, (section) =>
        this.repository.updateSection({
          ...section,
          updatedAtMs: effectiveUpdate(section.updatedAtMs, timestamp),
        }),
      );
      const section: Section = {
        id: this.newId((id) => this.repository.getSection(id)),
        projectId: validProjectId,
        name: validName,
        position,
        createdAtMs: timestamp,
        updatedAtMs: timestamp,
      };
      this.repository.insertSection(section);
      return section;
    });
  }

  renameSection(id: string, name: string): Section {
    const validId = validateId(id);
    const validName = validateText(name, "Section name");
    return this.repository.transaction(() => {
      const section = this.requireSection(validId);
      if (section.name === validName) {
        return section;
      }
      const updated = {
        ...section,
        name: validName,
        updatedAtMs: effectiveUpdate(section.updatedAtMs, this.operationTime()),
      };
      this.repository.updateSection(updated);
      return updated;
    });
  }

  listSections(projectId?: string): Section[] {
    const validProjectId = projectId === undefined ? undefined : validateId(projectId);
    if (validProjectId !== undefined) {
      this.requireProject(validProjectId);
    }
    return this.repository
      .listSections()
      .filter((section) => validProjectId === undefined || section.projectId === validProjectId)
      .sort(
        (left, right) =>
          (left.projectId < right.projectId ? -1 : left.projectId > right.projectId ? 1 : 0) ||
          compareOrdered(left, right),
      );
  }

  removeSection(id: string): void {
    const validId = validateId(id);
    this.repository.transaction(() => {
      const section = this.requireSection(validId);
      const allTasks = this.repository.listTasks();
      const sectionTasks = allTasks.filter((task) => task.sectionId === section.id).sort(compareOrdered);
      const directTasks = allTasks.filter((task) => task.projectId === section.projectId && task.sectionId === null);
      const operationTime = this.operationTime();

      for (const task of sectionTasks) {
        const position = appendPosition(directTasks, (existing) =>
          this.repository.updateTask({
            ...existing,
            updatedAtMs: effectiveUpdate(existing.updatedAtMs, operationTime),
          }),
        );
        const updated = {
          ...task,
          sectionId: null,
          position,
          updatedAtMs: effectiveUpdate(task.updatedAtMs, operationTime),
        };
        this.repository.updateTask(updated);
        directTasks.push(updated);
      }
      this.repository.deleteSection(section.id);
    });
  }

  createTask(input: CreateTaskInput): Task {
    const title = validateText(input.title, "Task title");
    const notes = validateNotes(input.notes ?? "");
    const priority = validatePriority(input.priority ?? "none");
    const due = validateDueValue(input.due ?? { kind: "none" });
    return this.repository.transaction(() => {
      const placement = this.validatedPlacement(input.placement);
      const tasks = this.tasksInPlacement(placement);
      const timestamp = this.operationTime();
      const position = appendPosition(tasks, (task) =>
        this.repository.updateTask({
          ...task,
          updatedAtMs: effectiveUpdate(task.updatedAtMs, timestamp),
        }),
      );
      const task: Task = {
        id: this.newId((id) => this.repository.getTask(id)),
        title,
        notes,
        priority,
        position,
        ...placementFields(placement),
        due,
        createdAtMs: timestamp,
        updatedAtMs: timestamp,
        completedAtMs: null,
        trashedAtMs: null,
      };
      this.repository.insertTask(task);
      return task;
    });
  }

  getTask(id: string): Task {
    return this.requireTask(id);
  }

  updateTask(id: string, input: UpdateTaskInput): Task {
    const validId = validateId(id);
    const title = input.title === undefined ? undefined : validateText(input.title, "Task title");
    const notes = input.notes === undefined ? undefined : validateNotes(input.notes);
    const priority = input.priority === undefined ? undefined : validatePriority(input.priority);
    const due = input.due === undefined ? undefined : validateDueValue(input.due);
    return this.repository.transaction(() => {
      const task = this.requireActiveTask(validId);
      const updated = {
        ...task,
        title: title ?? task.title,
        notes: notes ?? task.notes,
        priority: priority ?? task.priority,
        due: due ?? task.due,
      };
      if (
        task.title === updated.title &&
        task.notes === updated.notes &&
        task.priority === updated.priority &&
        sameDue(task.due, updated.due)
      ) {
        return task;
      }
      updated.updatedAtMs = effectiveUpdate(task.updatedAtMs, this.operationTime());
      this.repository.updateTask(updated);
      return updated;
    });
  }

  moveTask(id: string, placementValue: Placement): Task {
    const validId = validateId(id);
    return this.repository.transaction(() => {
      const task = this.requireActiveTask(validId);
      const placement = this.validatedPlacement(placementValue);
      if (samePlacement(placementOf(task), placement)) {
        return task;
      }
      const targetTasks = this.tasksInPlacement(placement);
      const operationTime = this.operationTime();
      const position = appendPosition(targetTasks, (existing) =>
        this.repository.updateTask({
          ...existing,
          updatedAtMs: effectiveUpdate(existing.updatedAtMs, operationTime),
        }),
      );
      const updated = {
        ...task,
        ...placementFields(placement),
        position,
        updatedAtMs: effectiveUpdate(task.updatedAtMs, operationTime),
      };
      this.repository.updateTask(updated);
      return updated;
    });
  }

  completeTask(id: string): Task {
    const validId = validateId(id);
    return this.repository.transaction(() => {
      const task = this.requireActiveTask(validId);
      if (task.completedAtMs !== null) {
        return task;
      }
      const timestamp = effectiveUpdate(task.updatedAtMs, this.operationTime());
      const updated = { ...task, completedAtMs: timestamp, updatedAtMs: timestamp };
      this.repository.updateTask(updated);
      return updated;
    });
  }

  reopenTask(id: string): Task {
    const validId = validateId(id);
    return this.repository.transaction(() => {
      const task = this.requireActiveTask(validId);
      if (task.completedAtMs === null) {
        return task;
      }
      const updated = {
        ...task,
        completedAtMs: null,
        updatedAtMs: effectiveUpdate(task.updatedAtMs, this.operationTime()),
      };
      this.repository.updateTask(updated);
      return updated;
    });
  }

  trashTask(id: string): Task {
    const validId = validateId(id);
    return this.repository.transaction(() => {
      const task = this.requireTask(validId);
      if (task.trashedAtMs !== null) {
        return task;
      }
      const timestamp = effectiveUpdate(task.updatedAtMs, this.operationTime());
      const updated = { ...task, trashedAtMs: timestamp, updatedAtMs: timestamp };
      this.repository.updateTask(updated);
      return updated;
    });
  }

  restoreTask(id: string): Task {
    const validId = validateId(id);
    return this.repository.transaction(() => {
      const task = this.requireTask(validId);
      if (task.trashedAtMs === null) {
        return task;
      }
      const updated = {
        ...task,
        trashedAtMs: null,
        updatedAtMs: effectiveUpdate(task.updatedAtMs, this.operationTime()),
      };
      this.repository.updateTask(updated);
      return updated;
    });
  }

  listAllTasks(viewerTimeZone: string): Task[] {
    return queryAllTasks(this.repository.listTasks(), viewerTimeZone);
  }

  listInbox(): Task[] {
    return queryInbox(this.repository.listTasks());
  }

  listProjectTasks(projectId: string): Task[] {
    const validProjectId = validateId(projectId);
    this.requireProject(validProjectId);
    return queryProject(this.repository.listTasks(), validProjectId);
  }

  listSectionTasks(sectionId: string): Task[] {
    const validSectionId = validateId(sectionId);
    this.requireSection(validSectionId);
    return querySection(this.repository.listTasks(), validSectionId);
  }

  listCompleted(): Task[] {
    return queryCompleted(this.repository.listTasks());
  }

  listTrash(): Task[] {
    return queryTrash(this.repository.listTasks());
  }

  listToday(evaluationInstantMs: number, viewerTimeZone: string): TodayResult {
    return queryToday(this.repository.listTasks(), evaluationInstantMs, viewerTimeZone);
  }

  listUpcoming(evaluationInstantMs: number, viewerTimeZone: string): UpcomingResult {
    return queryUpcoming(this.repository.listTasks(), evaluationInstantMs, viewerTimeZone);
  }
}
