/**
 * API Inspector emulation: a simplified, honest HTTP client against the simulated product API.
 * The response is derived from endpoint definitions, app settings and the latest simulation.
 */
import type { SimResult } from '../sim/types';
import { ERROR_STATUS } from '../sim/types';
import type { ContentBundle, EndpointDef, EvidenceToken, GameState, HttpMethod } from '../types';

export interface ApiRequest {
  method: HttpMethod;
  path: string;
  auth: 'none' | 'user' | 'admin' | 'other-user';
  body: 'none' | 'valid' | 'invalid' | 'malicious';
  origin?: 'same' | 'other';
}

export interface ApiResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  notes: string[];
  endpointId: string | null;
  pin?: EvidenceToken;
}

const TEXT: Record<number, string> = { 200: 'OK', 201: 'Created', 204: 'No Content', 301: 'Moved Permanently', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict', 422: 'Unprocessable Content', 429: 'Too Many Requests', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout' };

function matchPath(pattern: string, path: string): boolean {
  const a = pattern.split('?')[0].split('/').filter(Boolean);
  const b = path.split('?')[0].split('/').filter(Boolean);
  if (a.length !== b.length) return false;
  return a.every((seg, i) => seg.startsWith(':') || seg === b[i]);
}

export function findEndpoint(state: GameState, method: HttpMethod, path: string): { ep: EndpointDef | null; methodMismatch: EndpointDef | null } {
  const eps = state.world.endpoints.filter((e) => !e.disabled && e.target === 'backend');
  const byPath = eps.filter((e) => matchPath(e.path, path));
  const ep = byPath.find((e) => e.method === method) ?? null;
  return { ep, methodMismatch: ep ? null : byPath[0] ?? null };
}

export function callApi(state: GameState, content: ContentBundle, sim: SimResult | null, req: ApiRequest): ApiResponse {
  const w = state.world;
  const notes: string[] = [];
  const proper = String(w.app.apiStatusCodes ?? 'proper') === 'proper';
  const json = (status: number, body: unknown, extra: Record<string, string> = {}, epId: string | null = null): ApiResponse => {
    // "always 200" APIs hide errors inside a 200 response
    const shown = !proper && status >= 400 ? 200 : status;
    if (!proper && status >= 400) notes.push('api.note.always200');
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extra };
    if (w.app.requestIds === true) headers['X-Request-ID'] = 'b7e1c2d4-91aa-4c3e';
    return { status: shown, statusText: TEXT[shown] ?? '', headers, body: JSON.stringify(body, null, 2), notes, endpointId: epId, pin: { app: 'api', kind: 'response', key: `${epId ?? 'none'}:${shown}` } };
  };

  const { ep, methodMismatch } = findEndpoint(state, req.method, req.path);
  if (!ep) {
    if (methodMismatch) return json(405, { error: 'Method Not Allowed', allowed: [methodMismatch.method] }, { Allow: methodMismatch.method }, methodMismatch.id);
    return json(404, { error: 'Not Found', path: req.path });
  }
  const cors: Record<string, string> = {};
  if (req.origin === 'other') {
    const mode = String(w.app.cors ?? 'none');
    if (mode === 'wildcard') cors['Access-Control-Allow-Origin'] = '*';
    if (mode === 'origin') cors['Access-Control-Allow-Origin'] = `http://${state.company.domain ?? w.site.ip}`;
    if (mode === 'none') notes.push('api.note.corsMissing');
    if (mode === 'wildcard' && ep.auth !== 'none') notes.push('api.note.corsWildcardCredentials');
  }

  // availability from the simulation
  const s = sim?.endpoints[ep.id];
  if (s && s.errorRate > 0.5) {
    const code = Object.entries(s.errors).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0] as keyof typeof ERROR_STATUS | undefined;
    const status = code ? ERROR_STATUS[code] || 503 : 503;
    return json(status, { error: TEXT[status] ?? 'Error', code }, cors, ep.id);
  }

  // authentication / authorization
  if (ep.auth !== 'none') {
    const mode = String(w.app.authMode ?? 'none');
    if (req.auth === 'none' || mode === 'none') return json(401, { error: 'Unauthenticated' }, cors, ep.id);
    if (ep.auth === 'admin' && req.auth !== 'admin' && w.app.adminRoleCheck === true) return json(403, { error: 'Forbidden: admin role required' }, cors, ep.id);
    if (ep.auth === 'admin' && req.auth !== 'admin') notes.push('api.note.noRoleCheck');
  }
  if (ep.id === 'order_view' && req.auth === 'other-user') {
    if (w.app.ownershipChecks === true) return json(404, { error: 'Not Found' }, cors, ep.id);
    notes.push('api.note.idor');
    return json(200, { id: 1002, user: 'anna@example.com', address: 'Lenina 1, apt 5', phone: '+7 900 000-00-00', total: 4990 }, cors, ep.id);
  }

  // input
  if (req.body === 'invalid' && (ep.method === 'POST' || ep.method === 'PUT' || ep.method === 'PATCH')) {
    if (w.app.inputValidation === true) return json(422, { message: 'The given data was invalid.', errors: { email: ['The email must be a valid email address.'] } }, cors, ep.id);
    notes.push('api.note.noValidation');
  }
  if (req.body === 'malicious') {
    if (ep.id === 'search' || ep.id === 'login') {
      if (String(w.app.queryMode ?? 'concat') !== 'parameterized') {
        notes.push('api.note.sqli');
        return json(200, { results: [{ id: 1, email: 'admin@company', password: w.app.passwordStorage === 'plaintext' ? 'qwerty123' : '$2y$12$…' }, { id: 2, email: 'anna@example.com' }], count: 18234 }, cors, ep.id);
      }
      return json(200, { results: [], count: 0 }, cors, ep.id);
    }
    if (ep.id === 'reviews') {
      notes.push(w.app.outputEscaping === true ? 'api.note.escaped' : 'api.note.xssStored');
    }
  }

  // breaking change: v1 clients expect "price"
  let body: unknown = ep.example ?? (ep.method === 'GET' ? { ok: true } : { id: 101, status: 'created' });
  const renamed = w.bugs.find((b) => b.id === 'price-renamed' && !b.fixed);
  if (renamed && body && typeof body === 'object') {
    body = JSON.parse(JSON.stringify(body).replace(/"price":/g, '"price_cents":'));
    notes.push('api.note.breaking');
  }
  const status = ep.method === 'POST' && ep.writes ? 201 : ep.method === 'DELETE' ? 204 : 200;
  void content;
  return json(status, status === 204 ? {} : body, cors, ep.id);
}
