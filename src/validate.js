// Kichik sxema validatori (JSON Schema'ning qismi). Sxema OpenAPI hujjatida ham ishlatiladi.
import { isDate } from './dates.js';
import { unprocessable } from './errors.js';

function check(schema, v, path, errors, coerce) {
  if (v === null && schema.nullable) return null;
  let val = v;

  if (coerce && typeof v === 'string') {
    if (schema.type === 'integer' && /^-?\d+$/.test(v)) val = Number(v);
    else if (schema.type === 'number' && v.trim() !== '' && !Number.isNaN(Number(v))) val = Number(v);
    else if (schema.type === 'boolean' && (v === 'true' || v === 'false')) val = v === 'true';
  }

  const fail = (message) => { errors.push({ path, message }); return undefined; };

  switch (schema.type) {
    case 'string': {
      if (typeof val !== 'string') return fail('matn boʻlishi kerak');
      if (schema.trim !== false) val = val.trim();
      if (schema.minLength != null && val.length < schema.minLength) return fail(`kamida ${schema.minLength} belgi`);
      if (schema.maxLength != null && val.length > schema.maxLength) return fail(`koʻpi bilan ${schema.maxLength} belgi`);
      if (schema.enum && !schema.enum.includes(val)) return fail(`quyidagilardan biri boʻlishi kerak: ${schema.enum.join(', ')}`);
      if (schema.format === 'date' && !isDate(val)) return fail('sana YYYY-MM-DD formatida boʻlishi kerak');
      if (schema.pattern && !new RegExp(schema.pattern).test(val)) return fail('format notoʻgʻri');
      return val;
    }
    case 'integer':
    case 'number': {
      if (typeof val !== 'number' || !Number.isFinite(val)) return fail('son boʻlishi kerak');
      if (schema.type === 'integer' && !Number.isInteger(val)) return fail('butun son boʻlishi kerak');
      if (schema.minimum != null && val < schema.minimum) return fail(`${schema.minimum} dan kichik boʻlmasligi kerak`);
      if (schema.maximum != null && val > schema.maximum) return fail(`${schema.maximum} dan katta boʻlmasligi kerak`);
      return val;
    }
    case 'boolean':
      return typeof val === 'boolean' ? val : fail('true yoki false boʻlishi kerak');
    case 'array': {
      if (!Array.isArray(val)) return fail('roʻyxat boʻlishi kerak');
      if (schema.maxItems != null && val.length > schema.maxItems) return fail(`koʻpi bilan ${schema.maxItems} element`);
      if (schema.minItems != null && val.length < schema.minItems) return fail(`kamida ${schema.minItems} element`);
      return val.map((x, i) => check(schema.items || {}, x, `${path}[${i}]`, errors, coerce));
    }
    case 'object': {
      if (val === null || typeof val !== 'object' || Array.isArray(val)) return fail('obyekt boʻlishi kerak');
      const props = schema.properties || {};
      const out = {};
      for (const k of schema.required || []) {
        if (val[k] === undefined) errors.push({ path: path ? `${path}.${k}` : k, message: 'majburiy maydon' });
      }
      for (const [k, x] of Object.entries(val)) {
        const p = path ? `${path}.${k}` : k;
        if (!props[k]) {
          if (schema.additionalProperties === false) errors.push({ path: p, message: 'nomaʼlum maydon' });
          else if (schema.additionalProperties === true) out[k] = x;
          continue;
        }
        if (x === undefined) continue;
        out[k] = check(props[k], x, p, errors, coerce);
      }
      return out;
    }
    default:
      return val;
  }
}

export function validate(schema, value, { coerce = false } = {}) {
  const errors = [];
  const out = check(schema, value, '', errors, coerce);
  return { value: out, errors };
}

export function validateOrThrow(schema, value, opts) {
  const { value: out, errors } = validate(schema, value, opts);
  if (errors.length) throw unprocessable('Kiritilgan maʼlumotlar notoʻgʻri', { details: errors });
  return out;
}

// OpenAPI 3.0 uchun sxema (faqat bizning qo'shimcha kalitlarni olib tashlaydi)
export function toOpenApiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(toOpenApiSchema);
  if (schema && typeof schema === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(schema)) {
      if (k === 'trim') continue;
      out[k] = k === 'properties'
        ? Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, toOpenApiSchema(pv)]))
        : toOpenApiSchema(v);
    }
    return out;
  }
  return schema;
}
