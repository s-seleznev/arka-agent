import equal from "fast-deep-equal";
import type {
  FilterGroup,
  FilterNode,
  ReportViewState,
  ViewOperation,
} from "@/lib/farm/types";

function findFilterNode(root: FilterGroup, nodeId: string): FilterNode | null {
  if (root.id === nodeId) {
    return root;
  }
  for (const child of root.children) {
    if (child.id === nodeId) {
      return child;
    }
    if (child.kind === "group") {
      const nested = findFilterNode(child, nodeId);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

function filterTargetStayedTheSame(
  base: ReportViewState,
  current: ReportViewState,
  nodeId: string
) {
  const before = findFilterNode(base.filters, nodeId);
  const now = findFilterNode(current.filters, nodeId);
  const ancestry = (root: FilterGroup): unknown[] | null => {
    const visit = (
      group: FilterGroup,
      parents: unknown[]
    ): unknown[] | null => {
      if (group.id === nodeId) {
        return parents;
      }
      const path = [
        ...parents,
        { combinator: group.combinator, id: group.id, negated: group.negated },
      ];
      for (const child of group.children) {
        if (child.id === nodeId) {
          return path;
        }
        if (child.kind === "group") {
          const found = visit(child, path);
          if (found) {
            return found;
          }
        }
      }
      return null;
    };
    return visit(root, []);
  };
  return (
    before !== null &&
    now !== null &&
    equal(before, now) &&
    equal(ancestry(base.filters), ancestry(current.filters))
  );
}

/**
 * Decides whether an optimistic operation can be replayed over a newer view.
 * The check is deliberately conservative: it retries only when every part the
 * operation can affect is byte-for-byte unchanged since the user's edit began.
 */
export function canRebaseViewOperations(
  base: ReportViewState,
  current: ReportViewState,
  operations: ViewOperation[]
) {
  if (
    base.id !== current.id ||
    base.schemaVersion !== current.schemaVersion ||
    current.revision <= base.revision
  ) {
    return false;
  }

  return operations.every((operation) => {
    switch (operation.type) {
      case "view.update":
        return Object.keys(operation.patch).every((key) => {
          const property = key as keyof typeof operation.patch;
          return equal(base[property], current[property]);
        });
      case "filter.add":
        return filterTargetStayedTheSame(base, current, operation.parentId);
      case "filter.update":
      case "filter.remove":
        return filterTargetStayedTheSame(base, current, operation.nodeId);
      case "filter.move":
      case "filter.replace":
        return equal(base.filters, current.filters);
      case "sort.add":
      case "sort.update":
      case "sort.remove":
      case "sort.move":
        return equal(base.sort, current.sort);
      default:
        return false;
    }
  });
}
