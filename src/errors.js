const DEFAULT_CODES = {
  400: 'bad_request', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found',
  405: 'method_not_allowed', 409: 'conflict', 413: 'payload_too_large',
  422: 'validation_error', 429: 'rate_limited', 500: 'internal_error',
};

export class HttpError extends Error {
  constructor(status, message, { code, details } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code || DEFAULT_CODES[status] || 'error';
    this.details = details;
  }
}

export const badRequest = (m, o) => new HttpError(400, m, o);
export const unauthorized = (m = 'Avtorizatsiya talab qilinadi', o) => new HttpError(401, m, o);
export const forbidden = (m = 'Ruxsat yoʻq', o) => new HttpError(403, m, o);
export const notFound = (m = 'Topilmadi', o) => new HttpError(404, m, o);
export const conflict = (m, o) => new HttpError(409, m, o);
export const unprocessable = (m, o) => new HttpError(422, m, o);

// Handler holat kodini aniq belgilashi uchun (masalan 204 yoki 503)
export class Reply {
  constructor(status, body, { headers = {}, raw = false } = {}) {
    this.status = status;
    this.body = body;
    this.headers = headers;
    this.raw = raw;
  }
}
