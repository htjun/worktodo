import type { Project, Section, Task } from "./model";

export interface TaskRepository {
  transaction<T>(operation: () => T): T;

  getProject(id: string): Project | null;
  listProjects(): Project[];
  insertProject(project: Project): void;
  updateProject(project: Project): void;
  deleteProject(id: string): void;

  getSection(id: string): Section | null;
  listSections(): Section[];
  insertSection(section: Section): void;
  updateSection(section: Section): void;
  deleteSection(id: string): void;

  getTask(id: string): Task | null;
  listTasks(): Task[];
  insertTask(task: Task): void;
  updateTask(task: Task): void;
}
