/** Only the explicit synthetic policy family has a defined version order. */
export function currentBindings<T extends { farmId: string; version: string }>(
  bindings: T[]
): T[] {
  const result: T[] = [];
  for (const farmId of new Set(bindings.map((binding) => binding.farmId))) {
    const rows = bindings.filter((binding) => binding.farmId === farmId);
    const versions = rows.map(
      (binding) => /^synthetic-policy\/v([1-9]\d*)$/.exec(binding.version)?.[1]
    );
    if (versions.some((version) => !version)) {
      result.push(...rows);
    } else {
      const newest = versions.reduce(
        (max, version) =>
          BigInt(version ?? "0") > max ? BigInt(version ?? "0") : max,
        0n
      );
      result.push(
        ...rows.filter((_, index) => BigInt(versions[index] ?? "0") === newest)
      );
    }
  }
  return result;
}
