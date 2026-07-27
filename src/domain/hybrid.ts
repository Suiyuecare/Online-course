import { DomainError } from "./feature-gates";

export type RequirementNode = {
  id: string;
  required: boolean;
};

export type RequirementEdge = {
  from: string;
  to: string;
};

export function validateRequirementGraph(
  nodes: RequirementNode[],
  edges: RequirementEdge[],
): void {
  if (nodes.length === 0)
    throw new DomainError("EMPTY_GRAPH", "requirements are required");
  const ids = new Set(nodes.map((node) => node.id));
  if (ids.size !== nodes.length)
    throw new DomainError("DUPLICATE_NODE", "duplicate requirement");
  for (const edge of edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) {
      throw new DomainError("CROSS_VERSION_EDGE", "edge target missing");
    }
  }
  const incoming = new Map([...ids].map((id) => [id, 0]));
  const outgoing = new Map([...ids].map((id) => [id, [] as string[]]));
  for (const edge of edges) {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  }
  const queue = [...incoming]
    .filter(([, count]) => count === 0)
    .map(([id]) => id);
  if (queue.length === 0)
    throw new DomainError("NO_GRAPH_START", "graph has no start");
  let visited = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    visited++;
    for (const target of outgoing.get(id) ?? []) {
      const next = (incoming.get(target) ?? 0) - 1;
      incoming.set(target, next);
      if (next === 0) queue.push(target);
    }
  }
  if (visited !== nodes.length)
    throw new DomainError("GRAPH_CYCLE", "requirements must be a DAG");
  const ends = [...outgoing].filter(([, targets]) => targets.length === 0);
  if (ends.length === 0)
    throw new DomainError("NO_GRAPH_END", "graph has no completion path");
}
