import type { Project, Section } from "../domain/model";
import type { TaskService } from "../domain/task-service";

function notifyAfter<T>(operation: () => T, onChanged: () => void): T {
  const result = operation();
  onChanged();
  return result;
}

export function createProject(service: TaskService, name: string, onChanged: () => void): Project {
  return notifyAfter(() => service.createProject(name), onChanged);
}

export function renameProject(service: TaskService, projectId: string, name: string, onChanged: () => void): Project {
  return notifyAfter(() => service.renameProject(projectId, name), onChanged);
}

export function removeProject(service: TaskService, projectId: string, onChanged: () => void): void {
  notifyAfter(() => service.removeProject(projectId), onChanged);
}

export function createSection(service: TaskService, projectId: string, name: string, onChanged: () => void): Section {
  return notifyAfter(() => service.createSection(projectId, name), onChanged);
}

export function renameSection(service: TaskService, sectionId: string, name: string, onChanged: () => void): Section {
  return notifyAfter(() => service.renameSection(sectionId, name), onChanged);
}

export function removeSection(service: TaskService, sectionId: string, onChanged: () => void): void {
  notifyAfter(() => service.removeSection(sectionId), onChanged);
}
