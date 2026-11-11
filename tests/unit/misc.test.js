import test from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '../../src/logger.js';
import { Router } from '../../src/router.js';
import { HttpError, badRequest, conflict, forbidden, notFound, unauthorized, unprocessable } from '../../src/errors.js';
import { buildOpenApi } from '../../src/openapi.js';

test('logger: daraja bo‘yicha filtrlaydi va JSON yozadi', () => {
  const lines = [];
  const log = createLogger({ level: 'warn', write: (l) => lines.push(l) });
  log.debug('d'); log.info('i'); log.warn('w', { a: 1 }); log.error('e');
  assert.equal(lines.length, 2);
  const w = JSON.parse(lines[0]);
  assert.equal(w.level, 'warn');
  assert.equal(w.a, 1);
  assert.ok(w.ts);
  const silent = createLogger({ level: 'silent', write: (l) => lines.push(l) });
  silent.error('x');
  assert.equal(lines.length, 2);
});

test('xato yordamchilari to‘g‘ri status va kod beradi', () => {
  const cases = [[badRequest('x'), 400, 'bad_request'], [unauthorized(), 401, 'unauthorized'], [forbidden(), 403, 'forbidden'],
    [notFound(), 404, 'not_found'], [conflict('x'), 409, 'conflict'], [unprocessable('x'), 422, 'validation_error']];
  for (const [e, status, code] of cases) {
    assert.ok(e instanceof HttpError);
    assert.equal(e.status, status);
    assert.equal(e.code, code);
  }
  assert.equal(new HttpError(418, 'x').code, 'error');
  assert.equal(new HttpError(400, 'x', { code: 'custom', details: [1] }).details[0], 1);
});

test('router: parametr, metod, 405 va noto‘g‘ri id', () => {
  const r = new Router().add({ method: 'GET', path: '/a/:id' }).add({ method: 'POST', path: '/a/:id/x' });
  assert.deepEqual(r.match('GET', '/a/5').params, { id: 5 });
  assert.ok(r.match('GET', '/a/5/').route);
  assert.equal(r.match('POST', '/a/5').pathMatched, true);
  assert.equal(r.match('POST', '/a/5').route, undefined);
  for (const bad of ['/a/abc', '/a/0', '/a/-1', '/a/1.5', '/a/%E0%A4%A', '/a/01', '/nope']) {
    const m = r.match('GET', bad);
    assert.equal(m.route, undefined, bad);
    assert.equal(m.pathMatched, undefined, bad);
  }
  assert.deepEqual(r.match('POST', '/a/12/x').params, { id: 12 });
});

test('openapi: marshrutdan hujjat quradi (xavfsizlik, rollar, parametrlar)', () => {
  const routes = [
    { method: 'GET', path: '/pub', auth: false, tags: ['T'], summary: 's' },
    { method: 'POST', path: '/x/:id', roles: ['admin'], status: 201, tags: ['T'], summary: 's2',
      body: { type: 'object', properties: { a: { type: 'string', trim: false } } },
      query: { type: 'object', properties: { q: { type: 'string' } } } },
    { method: 'DELETE', path: '/x/:id', status: 204, tags: ['T'], summary: 's3' },
  ];
  const d = buildOpenApi(routes, { version: '9.9.9' });
  assert.equal(d.openapi, '3.0.3');
  assert.equal(d.info.version, '9.9.9');
  assert.deepEqual(d.paths['/pub'].get.security, []);
  const post = d.paths['/x/{id}'].post;
  assert.deepEqual(post.security, [{ bearerAuth: [] }]);
  assert.ok(post.responses['201'] && post.responses['401'] && post.responses['403'] && post.responses['422'] && post.responses['429']);
  assert.deepEqual(post.parameters.map((p) => `${p.in}:${p.name}`), ['path:id', 'query:q']);
  assert.equal(post.requestBody.content['application/json'].schema.properties.a.trim, undefined);
  assert.ok(d.paths['/x/{id}'].delete.responses['204']);
});
