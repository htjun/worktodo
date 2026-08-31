import { DomainError, type Placement, type Project, type Section } from "../domain/model";

const PROJECT_PREFIX = "project:";
const SECTION_PREFIX = "section:";

export const INBOX_PLACEMENT: Placement = { kind: "inbox" };

export function placementKey(placement: Placement): string {
  switch (placement.kind) {
    case "inbox":
      return "inbox";
    case "project":
      return `${PROJECT_PREFIX}${placement.projectId}`;
    case "section":
      return `${SECTION_PREFIX}${placement.sectionId}`;
  }
}

export function placementFromKey(key: string, projects: readonly Project[], sections: readonly Section[]): Placement {
  if (key === "inbox") {
    return INBOX_PLACEMENT;
  }
  if (key.startsWith(PROJECT_PREFIX)) {
    const projectId = key.slice(PROJECT_PREFIX.length);
    if (projects.some((project) => project.id === projectId)) {
      return { kind: "project", projectId };
    }
  }
  if (key.startsWith(SECTION_PREFIX)) {
    const sectionId = key.slice(SECTION_PREFIX.length);
    const section = sections.find((candidate) => candidate.id === sectionId);
    if (section && projects.some((project) => project.id === section.projectId)) {
      return { kind: "section", projectId: section.projectId, sectionId };
    }
  }
  throw new DomainError("INVALID_PLACEMENT", "Choose an existing project or section");
}
