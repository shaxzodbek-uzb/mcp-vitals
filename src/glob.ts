// Minimal name-glob matcher for --filter/--only/--skip. Supports `*` and `?`.
// No external dependency, no path semantics — just simple name matching.
//
// Implemented as a linear two-pointer matcher rather than a `.*`-based regex,
// so there is no catastrophic backtracking (ReDoS) on pathological globs like
// `"*".repeat(20) + "x"` against a long name.

export function matchesGlob(name: string, glob: string): boolean {
  let n = 0;
  let g = 0;
  let star = -1;
  let mark = 0;
  while (n < name.length) {
    if (g < glob.length && (glob[g] === '?' || glob[g] === name[n])) {
      n++;
      g++;
    } else if (g < glob.length && glob[g] === '*') {
      star = g;
      mark = n;
      g++;
    } else if (star !== -1) {
      g = star + 1;
      mark++;
      n = mark;
    } else {
      return false;
    }
  }
  while (g < glob.length && glob[g] === '*') g++;
  return g === glob.length;
}

/** True if `name` matches any of the provided globs (empty list => true). */
export function matchesAny(name: string, globs: string[] | undefined): boolean {
  if (!globs || globs.length === 0) return true;
  return globs.some((g) => matchesGlob(name, g));
}
