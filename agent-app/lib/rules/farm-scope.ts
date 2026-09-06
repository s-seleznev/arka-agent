import type { FilterNode } from "../farm/types";

// Non-farm predicates are unknown here: this only rules out an incompatible
// explicit farm scope; actual predicates and access are checked by the SQL path.
export function farmMayMatch(
  node: FilterNode,
  farmId: string
): [boolean, boolean] {
  let result: [boolean, boolean];
  if (node.kind === "group") {
    if (node.children.length === 0) {
      return node.negated ? [false, true] : [true, false];
    }
    const values = node.children.map((child) => farmMayMatch(child, farmId));
    result =
      node.combinator === "and"
        ? [values.every((v) => v[0]), values.some((v) => v[1])]
        : [values.some((v) => v[0]), values.every((v) => v[1])];
  } else if (node.field === "farmId") {
    const { value } = node;
    const matches =
      value?.type === "list"
        ? value.values.some((item) => String(item.value) === farmId)
        : value?.type === "string" && value.value === farmId;
    const positive = node.operator === "eq" || node.operator === "in";
    result = [positive ? matches : !matches, positive ? !matches : matches];
  } else {
    result = [true, true];
  }
  return node.negated ? [result[1], result[0]] : result;
}
