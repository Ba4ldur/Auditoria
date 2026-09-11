/**
 * Thin, defensive accessors over the object tree produced by fast-xml-parser.
 *
 * Fiscal XML files vary between layout versions and between issuers' software,
 * so every access is optional-by-default and never throws.
 */

export type XmlNode = Record<string, unknown>;

export function isNode(value: unknown): value is XmlNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Follows a path of tag names, returning the first node found. */
export function node(root: unknown, ...path: readonly string[]): XmlNode | null {
  let current: unknown = root;
  for (const key of path) {
    if (Array.isArray(current)) current = current[0];
    if (!isNode(current)) return null;
    current = current[key];
  }
  if (Array.isArray(current)) current = current[0];
  return isNode(current) ? current : null;
}

/** Reads a leaf value as trimmed text. Numbers are preserved verbatim. */
export function text(root: unknown, ...path: readonly string[]): string | null {
  let current: unknown = root;
  for (const key of path) {
    if (Array.isArray(current)) current = current[0];
    if (!isNode(current)) return null;
    current = current[key];
  }
  if (Array.isArray(current)) current = current[0];
  if (current === null || current === undefined) return null;
  if (typeof current === 'string') {
    const trimmed = current.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof current === 'number' || typeof current === 'boolean') return String(current);
  return null;
}

/** Reads an XML attribute (fast-xml-parser is configured with the `@_` prefix). */
export function attr(target: unknown, name: string): string | null {
  if (Array.isArray(target)) target = target[0];
  if (!isNode(target)) return null;
  const value = target[`@_${name}`];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof value === 'number') return String(value);
  return null;
}

/** Normalises a possibly-single, possibly-absent child into an array. */
export function asArray(value: unknown): XmlNode[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.filter(isNode);
  return isNode(value) ? [value] : [];
}

/**
 * Returns the first child node whose tag matches one of `names`.
 * Used for the ICMS group, whose tag depends on the taxation code
 * (`ICMS00`, `ICMS10`, ..., `ICMSSN101`, ...).
 */
export function firstChild(parent: unknown, predicate: (tag: string) => boolean): XmlNode | null {
  if (Array.isArray(parent)) parent = parent[0];
  if (!isNode(parent)) return null;
  for (const [tag, value] of Object.entries(parent)) {
    if (tag.startsWith('@_')) continue;
    if (!predicate(tag)) continue;
    const candidate = Array.isArray(value) ? value[0] : value;
    if (isNode(candidate)) return candidate;
  }
  return null;
}

/** Depth-first search for the first value of any leaf named `name`. */
export function findText(root: unknown, name: string, maxDepth = 8): string | null {
  if (maxDepth < 0) return null;
  if (Array.isArray(root)) {
    for (const entry of root) {
      const found = findText(entry, name, maxDepth - 1);
      if (found !== null) return found;
    }
    return null;
  }
  if (!isNode(root)) return null;
  const direct = root[name];
  if (direct !== undefined) {
    const value = Array.isArray(direct) ? direct[0] : direct;
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
    if (typeof value === 'number') return String(value);
  }
  for (const [tag, value] of Object.entries(root)) {
    if (tag.startsWith('@_')) continue;
    const found = findText(value, name, maxDepth - 1);
    if (found !== null) return found;
  }
  return null;
}
