// OpenAPI 3.0 hujjati marshrutlar ta'rifidan AVTOMATIK yaratiladi (kod bilan doim sinxron).
import { toOpenApiSchema } from './validate.js';

const errorResp = (description) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});

export function buildOpenApi(routes, { version = '1.0.0' } = {}) {
  const paths = {};
  for (const r of routes) {
    const oasPath = r.path.replace(/:([a-zA-Z_]+)/g, '{$1}');
    const parameters = [];
    for (const k of r.keys ?? [...r.path.matchAll(/:([a-zA-Z_]+)/g)].map((m) => m[1])) {
      parameters.push({ name: k, in: 'path', required: true, schema: { type: 'integer', minimum: 1 } });
    }
    for (const [name, schema] of Object.entries(r.query?.properties ?? {})) {
      parameters.push({ name, in: 'query', required: false, schema: toOpenApiSchema(schema) });
    }
    const success = r.status ?? 200;
    const responses = {
      [success]: { description: success === 204 ? 'Muvaffaqiyatli (javob tanasi yoʻq)' : 'Muvaffaqiyatli' },
      429: errorResp('Soʻrovlar soni chegaradan oshdi'),
    };
    if (r.body || r.query) responses[422] = errorResp('Kiritilgan maʼlumotlar notoʻgʻri');
    if (r.auth !== false) {
      responses[401] = errorResp('Token yoʻq yoki yaroqsiz');
      if (r.roles) responses[403] = errorResp(`Ruxsat yoʻq (kerakli rol: ${r.roles.join(', ')})`);
    }
    const op = {
      tags: r.tags,
      summary: r.summary,
      ...(r.roles ? { description: `Ruxsat etilgan rollar: ${r.roles.join(', ')}` } : {}),
      ...(parameters.length ? { parameters } : {}),
      ...(r.body ? { requestBody: { required: true, content: { 'application/json': { schema: toOpenApiSchema(r.body) } } } } : {}),
      responses,
      security: r.auth === false ? [] : [{ bearerAuth: [] }],
    };
    (paths[oasPath] ??= {})[r.method.toLowerCase()] = op;
  }
  return {
    openapi: '3.0.3',
    info: {
      title: 'Hujjat aylanish tizimi API',
      version,
      description: 'Admin paneli integratsiyasi uchun REST API. Avtorizatsiya: `POST /auth/login` → `Authorization: Bearer <access_token>`.',
    },
    servers: [{ url: '/api/v1' }],
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            code: { type: 'string' },
            request_id: { type: 'string' },
            details: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, message: { type: 'string' } } } },
          },
        },
      },
    },
  };
}
