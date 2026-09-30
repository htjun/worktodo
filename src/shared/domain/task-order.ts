export type TaskOrderDirection = "up" | "down";

export function applyManualTaskOrder<T extends { id: string }>(items: readonly T[], order: readonly string[]): T[] {
  const ranks = new Map(order.map((id, index) => [id, index]));
  return [...items].sort(
    (left, right) => (ranks.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (ranks.get(right.id) ?? Number.MAX_SAFE_INTEGER),
  );
}
