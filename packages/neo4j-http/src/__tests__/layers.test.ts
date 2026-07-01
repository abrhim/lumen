import { describe, it, expect } from 'vitest';
import { resolvePlaceholders, validateLayerQuery } from '../layers';

// Failure mode 2: layer placeholder resolution
describe('resolvePlaceholders', () => {
  it('replaces {Label} with prefixed label', () => {
    const result = resolvePlaceholders('MATCH (p:{Person}) RETURN p', 'Kennedy');
    expect(result).toBe('MATCH (p:Kennedy_Person) RETURN p');
  });

  it('replaces multiple placeholders', () => {
    const result = resolvePlaceholders(
      'MATCH (p:{Person})-[:WROTE]->(b:{Book}) RETURN p, b',
      'Shreeve',
    );
    expect(result).toBe('MATCH (p:Shreeve_Person)-[:WROTE]->(b:Shreeve_Book) RETURN p, b');
  });

  it('does not replace labels inside $params or strings', () => {
    const result = resolvePlaceholders(
      "MATCH (n:{Person}) WHERE n.name = $name AND n.label = '{NotALabel}' RETURN n",
      'Kennedy',
    );
    expect(result).toContain('Kennedy_Person');
    // String literal {NotALabel} should NOT be replaced (it's inside quotes)
    expect(result).toContain("'{NotALabel}'");
  });

  it('handles labels with numbers and underscores', () => {
    const result = resolvePlaceholders('MATCH (n:{Case_Example_2}) RETURN n', 'KB');
    expect(result).toBe('MATCH (n:KB_Case_Example_2) RETURN n');
  });
});

// Failure mode 2: reject raw labels in layer queries
describe('validateLayerQuery', () => {
  it('rejects unbraced labels that match known entity types', () => {
    const entityTypes = ['Person', 'Tactic', 'Principle'];
    expect(() =>
      validateLayerQuery('MATCH (n:Person) RETURN n', entityTypes),
    ).toThrow();
  });

  it('allows braced labels', () => {
    const entityTypes = ['Person', 'Tactic'];
    expect(() =>
      validateLayerQuery('MATCH (n:{Person}) RETURN n', entityTypes),
    ).not.toThrow();
  });

  it('allows relationship types (not labels)', () => {
    const entityTypes = ['Person'];
    expect(() =>
      validateLayerQuery('MATCH (n:{Person})-[:IMPLEMENTS]->(m:{Person}) RETURN n', entityTypes),
    ).not.toThrow();
  });

  it('allows labels in string literals', () => {
    const entityTypes = ['Person'];
    expect(() =>
      validateLayerQuery("MATCH (n:{Person}) WHERE n.type = 'Person' RETURN n", entityTypes),
    ).not.toThrow();
  });
});

// Failure mode 3: cross-layer query resolution
describe('resolvePlaceholders — cross-layer', () => {
  it('resolves placeholders for multiple layers with OR semantics', () => {
    const result = resolvePlaceholders(
      'MATCH (p:{Person}) RETURN p',
      ['Kennedy', 'Shreeve'],
    );
    expect(result).toContain('Kennedy_Person');
    expect(result).toContain('Shreeve_Person');
    expect(result).toContain(' OR ');
    expect(result).not.toContain('Kennedy_Person:');
  });

  it('single-element array produces plain label without OR', () => {
    const result = resolvePlaceholders(
      'MATCH (p:{Person}) RETURN p',
      ['Kennedy'],
    );
    expect(result).toBe('MATCH (p:Kennedy_Person) RETURN p');
  });
});
