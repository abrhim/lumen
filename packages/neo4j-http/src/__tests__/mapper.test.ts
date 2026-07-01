import { describe, it, expect } from 'vitest';
import { mapTypedValue, mapRow } from '../mapper';

// Failure mode 1: typed JSON mapping
describe('mapTypedValue — Neo4j typed JSON to JS primitives', () => {
  it('converts Integer $type to number', () => {
    expect(mapTypedValue({ $type: 'Integer', _value: '42' })).toBe(42);
  });

  it('converts large Integer to number (within safe range)', () => {
    expect(mapTypedValue({ $type: 'Integer', _value: '9007199254740991' })).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it('converts Float $type to number', () => {
    expect(mapTypedValue({ $type: 'Float', _value: 3.14 })).toBe(3.14);
  });

  it('converts String $type to string', () => {
    expect(mapTypedValue({ $type: 'String', _value: 'hello' })).toBe('hello');
  });

  it('converts Boolean $type to boolean', () => {
    expect(mapTypedValue({ $type: 'Boolean', _value: true })).toBe(true);
  });

  it('converts Date $type to string', () => {
    expect(mapTypedValue({ $type: 'Date', _value: '2024-01-15' })).toBe('2024-01-15');
  });

  it('converts DateTime $type to string', () => {
    const dt = '2024-01-15T10:30:00Z';
    expect(mapTypedValue({ $type: 'OffsetDateTime', _value: dt })).toBe(dt);
  });

  it('converts LocalDateTime $type to string', () => {
    expect(mapTypedValue({ $type: 'LocalDateTime', _value: '2024-01-15T10:30:00' })).toBe(
      '2024-01-15T10:30:00',
    );
  });

  it('converts Duration $type to string', () => {
    expect(mapTypedValue({ $type: 'Duration', _value: 'P1Y2M3DT4H5M6S' })).toBe(
      'P1Y2M3DT4H5M6S',
    );
  });

  it('converts Node $type to {properties + _labels}', () => {
    const node = {
      $type: 'Node',
      _value: {
        _element_id: '4:xxx:0',
        _labels: ['Person', 'KB_dan_kennedy_umm'],
        _properties: {
          name: { $type: 'String', _value: 'Alice' },
          age: { $type: 'Integer', _value: '30' },
        },
      },
    };
    const result = mapTypedValue(node);
    expect(result).toEqual({ name: 'Alice', age: 30, _labels: ['Person', 'KB_dan_kennedy_umm'] });
  });

  it('converts Relationship $type to {properties + _type + _startId + _endId}', () => {
    const rel = {
      $type: 'Relationship',
      _value: {
        _element_id: '5:xxx:1',
        _start_node_element_id: '4:xxx:0',
        _end_node_element_id: '4:xxx:2',
        _type: 'IMPLEMENTS',
        _properties: {
          weight: { $type: 'Float', _value: 0.9 },
        },
      },
    };
    const result = mapTypedValue(rel);
    expect(result).toEqual({
      weight: 0.9,
      _type: 'IMPLEMENTS',
      _startId: '4:xxx:0',
      _endId: '4:xxx:2',
    });
  });

  it('converts List $type to array', () => {
    const list = {
      $type: 'List',
      _value: [
        { $type: 'Integer', _value: '1' },
        { $type: 'Integer', _value: '2' },
      ],
    };
    expect(mapTypedValue(list)).toEqual([1, 2]);
  });

  it('converts Map $type to object', () => {
    const map = {
      $type: 'Map',
      _value: {
        name: { $type: 'String', _value: 'test' },
        count: { $type: 'Integer', _value: '5' },
      },
    };
    expect(mapTypedValue(map)).toEqual({ name: 'test', count: 5 });
  });

  it('passes through null', () => {
    expect(mapTypedValue(null)).toBe(null);
  });

  it('passes through plain values (no $type)', () => {
    expect(mapTypedValue('plain')).toBe('plain');
    expect(mapTypedValue(42)).toBe(42);
    expect(mapTypedValue(true)).toBe(true);
  });
});

describe('mapRow — maps fields + values to keyed object', () => {
  it('maps a row with multiple typed values', () => {
    const fields = ['name', 'age', 'active'];
    const values = [
      { $type: 'String', _value: 'Alice' },
      { $type: 'Integer', _value: '30' },
      { $type: 'Boolean', _value: true },
    ];
    expect(mapRow(fields, values)).toEqual({ name: 'Alice', age: 30, active: true });
  });

  it('handles null values in row', () => {
    const fields = ['name', 'description'];
    const values = [{ $type: 'String', _value: 'Alice' }, null];
    expect(mapRow(fields, values)).toEqual({ name: 'Alice', description: null });
  });
});
