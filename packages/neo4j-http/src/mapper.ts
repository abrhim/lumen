import type { TypedValue } from './types';

function isTypedValue(val: unknown): val is TypedValue {
  return val !== null && typeof val === 'object' && '$type' in val && '_value' in val;
}

function mapProperties(props: Record<string, unknown>): Record<string, unknown> {
  const out = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(props)) {
    out[key] = mapTypedValue(props[key]);
  }
  return out;
}

export function mapTypedValue(val: unknown): unknown {
  if (val === null || val === undefined) return null;
  if (!isTypedValue(val)) return val;

  switch (val.$type) {
    case 'Integer':
      return Number(val._value);
    case 'Float':
      return Number(val._value);
    case 'String':
      return val._value;
    case 'Boolean':
      return val._value;
    case 'Date':
    case 'OffsetDateTime':
    case 'LocalDateTime':
    case 'ZonedDateTime':
    case 'LocalTime':
    case 'OffsetTime':
    case 'Duration':
      return val._value;
    case 'Node': {
      const node = val._value as {
        _element_id: string;
        _labels: string[];
        _properties: Record<string, unknown>;
      };
      const props = mapProperties(node._properties);
      props._labels = node._labels;
      return props;
    }
    case 'Relationship': {
      const rel = val._value as {
        _element_id: string;
        _start_node_element_id: string;
        _end_node_element_id: string;
        _type: string;
        _properties: Record<string, unknown>;
      };
      const props = mapProperties(rel._properties);
      props._type = rel._type;
      props._startId = rel._start_node_element_id;
      props._endId = rel._end_node_element_id;
      return props;
    }
    case 'List':
      return (val._value as unknown[]).map(mapTypedValue);
    case 'Map':
      return mapProperties(val._value as Record<string, unknown>);
    default:
      return val._value;
  }
}

export function mapRow(
  fields: string[],
  values: unknown[],
): Record<string, unknown> {
  const row = Object.create(null) as Record<string, unknown>;
  for (let i = 0; i < fields.length; i++) {
    row[fields[i]] = mapTypedValue(values[i]);
  }
  return row;
}
