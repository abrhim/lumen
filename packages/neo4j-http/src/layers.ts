const PLACEHOLDER_RE = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;
const STRING_LITERAL_RE = /'[^']*'|"[^"]*"/g;

export function resolvePlaceholders(
  cypher: string,
  prefix: string | string[],
): string {
  if (Array.isArray(prefix)) {
    return cypher.replace(PLACEHOLDER_RE, (match, label, offset) => {
      if (isInsideStringLiteral(cypher, offset)) return match;
      const alternatives = prefix.map((p) => `${p}_${label}`);
      if (alternatives.length === 1) return alternatives[0];
      return alternatives.join(' OR ');
    });
  }

  return cypher.replace(PLACEHOLDER_RE, (match, label, offset) => {
    if (isInsideStringLiteral(cypher, offset)) return match;
    return `${prefix}_${label}`;
  });
}

function isInsideStringLiteral(cypher: string, offset: number): boolean {
  let match: RegExpExecArray | null;
  const re = new RegExp(STRING_LITERAL_RE.source, 'g');
  while ((match = re.exec(cypher)) !== null) {
    if (offset >= match.index && offset < match.index + match[0].length) {
      return true;
    }
  }
  return false;
}

const LABEL_PREFIX_RE = /(?<=:)([A-Za-z][A-Za-z0-9_]*)/g;

export function validateLayerQuery(
  cypher: string,
  entityTypes: string[],
): void {
  const stripped = cypher.replace(STRING_LITERAL_RE, '""');
  const withoutBraced = stripped.replace(PLACEHOLDER_RE, '{}');
  const withoutRelTypes = withoutBraced.replace(/\[:[A-Za-z_|]+\]/g, '[]');

  let match: RegExpExecArray | null;
  const re = new RegExp(LABEL_PREFIX_RE.source, 'g');
  while ((match = re.exec(withoutRelTypes)) !== null) {
    const label = match[1];
    if (entityTypes.includes(label)) {
      throw new Error(
        `Raw label "${label}" found in layer query. Use {${label}} placeholder instead.`,
      );
    }
  }
}
