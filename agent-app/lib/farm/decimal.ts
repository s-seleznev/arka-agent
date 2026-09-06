/** Compare decimal input without a round-trip through IEEE-754 numbers. */
export function compareDecimals(left: string | number, right: string | number) {
  const parse = (input: string | number) => {
    const [mantissa, exponent = "0"] = String(input).toLowerCase().split("e");
    const fraction = mantissa.split(".")[1]?.length ?? 0;
    return {
      coefficient: BigInt(mantissa.replace(".", "")),
      scale: fraction - Number(exponent),
    };
  };
  const a = parse(left);
  const b = parse(right);
  const scale = Math.max(a.scale, b.scale);
  const av = a.coefficient * 10n ** BigInt(scale - a.scale);
  const bv = b.coefficient * 10n ** BigInt(scale - b.scale);
  return av < bv ? -1 : av > bv ? 1 : 0;
}
