import test from 'node:test';
import assert from 'node:assert/strict';
import { toOpenApiSchema, validate, validateOrThrow } from '../../src/validate.js';
import { HttpError } from '../../src/errors.js';

const schema = {
  type: 'object', additionalProperties: false, required: ['name', 'age'],
  properties: {
    name: { type: 'string', minLength: 2, maxLength: 5 },
    age: { type: 'integer', minimum: 1, maximum: 120 },
    day: { type: 'string', format: 'date' },
    kind: { type: 'string', enum: ['a', 'b'] },
    ok: { type: 'boolean' },
    ref: { type: 'integer', nullable: true },
    ids: { type: 'array', maxItems: 2, items: { type: 'integer', minimum: 1 } },
    code: { type: 'string', pattern: '^[A-Z]+$' },
  },
};
const errs = (v, o) => validate(schema, v, o).errors.map((e) => `${e.path}:${e.message}`);

test('to‘g‘ri qiymat xatosiz o‘tadi va satrlar trim qilinadi', () => {
  const { value, errors } = validate(schema, { name: '  Ali ', age: 30 });
  assert.deepEqual(errors, []);
  assert.deepEqual(value, { name: 'Ali', age: 30 });
});

test('majburiy maydon, noma‘lum maydon va tur xatolari', () => {
  assert.ok(errs({}).includes('name:majburiy maydon'));
  assert.ok(errs({ name: 'Ali', age: 3, zzz: 1 }).includes('zzz:nomaʼlum maydon'));
  assert.ok(errs({ name: 5, age: 3 }).some((e) => e.startsWith('name:')));
  assert.ok(errs({ name: 'Ali', age: 1.5 }).some((e) => e.startsWith('age:')));
  assert.ok(errs('matn').length === 1);
  assert.ok(errs([]).length === 1);
});

test('chegaralar: uzunlik, min/max, enum, pattern, sana, massiv', () => {
  assert.ok(errs({ name: 'A', age: 3 }).some((e) => e.startsWith('name:')));
  assert.ok(errs({ name: 'Abcdefg', age: 3 }).some((e) => e.startsWith('name:')));
  assert.ok(errs({ name: 'Ali', age: 0 }).some((e) => e.startsWith('age:')));
  assert.ok(errs({ name: 'Ali', age: 121 }).some((e) => e.startsWith('age:')));
  assert.ok(errs({ name: 'Ali', age: 3, kind: 'c' }).some((e) => e.startsWith('kind:')));
  assert.ok(errs({ name: 'Ali', age: 3, code: 'abc' }).some((e) => e.startsWith('code:')));
  assert.ok(errs({ name: 'Ali', age: 3, day: '2026-02-30' }).some((e) => e.startsWith('day:')));
  assert.deepEqual(errs({ name: 'Ali', age: 3, day: '2026-02-28' }), []);
  assert.ok(errs({ name: 'Ali', age: 3, ids: [1, 2, 3] }).some((e) => e.startsWith('ids:')));
  assert.ok(errs({ name: 'Ali', age: 3, ids: [1, 'x'] }).some((e) => e.startsWith('ids[1]:')));
  assert.ok(errs({ name: 'Ali', age: 3, ok: 'true' }).some((e) => e.startsWith('ok:')));
});

test('nullable: null qabul qilinadi, aks holda rad', () => {
  assert.deepEqual(errs({ name: 'Ali', age: 3, ref: null }), []);
  assert.ok(errs({ name: 'Ali', age: null }).some((e) => e.startsWith('age:')));
});

test('coerce (query uchun): matndan son va boolean', () => {
  const r = validate(schema, { name: 'Ali', age: '42', ok: 'false' }, { coerce: true });
  assert.deepEqual(r.errors, []);
  assert.equal(r.value.age, 42);
  assert.equal(r.value.ok, false);
  assert.ok(validate(schema, { name: 'Ali', age: '4x' }, { coerce: true }).errors.length > 0);
  assert.ok(validate(schema, { name: 'Ali', age: '42' }).errors.length > 0); // coerce o‘chiq
  const n = validate({ type: 'number' }, '1.5', { coerce: true });
  assert.equal(n.value, 1.5);
});

test('validateOrThrow 422 HttpError tashlaydi', () => {
  assert.throws(() => validateOrThrow(schema, {}), (e) => e instanceof HttpError && e.status === 422 && e.details.length > 0);
  assert.deepEqual(validateOrThrow(schema, { name: 'Ali', age: 3 }), { name: 'Ali', age: 3 });
});

test('toOpenApiSchema ichki "trim" kalitini olib tashlaydi', () => {
  const out = toOpenApiSchema({ type: 'object', properties: { p: { type: 'string', trim: false, minLength: 1 } } });
  assert.deepEqual(out, { type: 'object', properties: { p: { type: 'string', minLength: 1 } } });
});
