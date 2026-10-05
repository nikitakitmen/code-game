import { maybeComponent } from './catalog';
import { evaluate, type Facts } from './conditions';
import type { AttackDef, AttackResult, ContentBundle, GameState, World } from './types';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface VulnDef {
  id: string;
  severity: Severity;
  /** knowledge node that makes the player aware of this class of problem */
  knowledge: string;
  check: (w: World, content: ContentBundle) => boolean;
}

const role = (content: ContentBundle, type: string) => maybeComponent(content, type)?.role;
const hasEp = (w: World, id: string) => w.endpoints.some((e) => e.id === id && !e.disabled);
const appIs = (w: World, k: string, v: unknown) => w.app[k] === v;

export const VULNS: VulnDef[] = [
  { id: 'plaintextPasswords', severity: 'critical', knowledge: 'sec.hashing', check: (w) => hasEp(w, 'register') && appIs(w, 'passwordStorage', 'plaintext') },
  { id: 'weakHashing', severity: 'high', knowledge: 'sec.hashing', check: (w) => hasEp(w, 'register') && ['md5', 'sha256'].includes(String(w.app.passwordStorage)) },
  { id: 'sqli', severity: 'critical', knowledge: 'sec.sqli', check: (w) => (hasEp(w, 'search') || hasEp(w, 'login')) && !appIs(w, 'queryMode', 'parameterized') },
  { id: 'xss', severity: 'high', knowledge: 'sec.xss', check: (w) => hasEp(w, 'reviews') && w.app.outputEscaping !== true },
  { id: 'csrf', severity: 'high', knowledge: 'sec.csrf', check: (w) => ['session', 'plain-cookie'].includes(String(w.app.authMode)) && hasEp(w, 'account_email') && String(w.app.csrfProtection ?? 'none') === 'none' },
  { id: 'idor', severity: 'high', knowledge: 'sec.idor', check: (w) => hasEp(w, 'order_view') && w.app.ownershipChecks !== true },
  { id: 'bruteForce', severity: 'medium', knowledge: 'sec.rateLimit', check: (w, c) => hasEp(w, 'login') && w.app.loginRateLimit !== true && !w.nodes.some((n) => role(c, n.type) === 'proxy' && Number(n.config.rateLimit ?? 0) > 0) && !w.nodes.some((n) => role(c, n.type) === 'waf' && n.config.mode === 'block' && n.config.ruleBots === true) },
  { id: 'exposedDatabase', severity: 'critical', knowledge: 'sec.exposedPorts', check: (w, c) => w.nodes.some((n) => (role(c, n.type) === 'database' || role(c, n.type) === 'replica') && n.publicPorts.some((p) => p === 3306 || p === 5432)) },
  { id: 'exposedBackend', severity: 'medium', knowledge: 'net.reverseProxy', check: (w, c) => w.nodes.some((n) => role(c, n.type) === 'proxy') && w.nodes.some((n) => role(c, n.type) === 'backend' && n.publicPorts.includes(Number(n.config.port ?? 8000))) },
  { id: 'secretLeak', severity: 'critical', knowledge: 'sec.secrets', check: (w) => w.security.secrets.some((s) => (s.leaked || s.inGitHistory) && s.rotatedAt === null) },
  { id: 'unsafeUpload', severity: 'critical', knowledge: 'sec.upload', check: (w) => hasEp(w, 'avatar') && w.app.uploadValidation !== true },
  { id: 'vulnerableDependency', severity: 'high', knowledge: 'sec.dependencies', check: (w) => w.security.deps.some((d) => d.cve && compareVersions(d.version, d.cve.fixedIn) < 0) },
  { id: 'ssrf', severity: 'high', knowledge: 'sec.ssrf', check: (w) => hasEp(w, 'import_url') && w.app.ssrfProtection !== true },
  { id: 'excessivePermissions', severity: 'medium', knowledge: 'sec.leastPrivilege', check: (w) => w.security.employees.filter((e) => e.role === 'admin').length > 2 || w.app.leastPrivilegeKeys === false },
  { id: 'tamperableSession', severity: 'critical', knowledge: 'auth.session', check: (w) => ['url-param', 'plain-cookie'].includes(String(w.app.authMode)) },
  { id: 'noHttps', severity: 'high', knowledge: 'net.tls', check: (w) => !!w.dns.domain && hasEp(w, 'login') && !w.tls.enabled },
  { id: 'missingAuthorization', severity: 'critical', knowledge: 'auth.authorization', check: (w) => hasEp(w, 'admin_products') && w.app.adminRoleCheck !== true },
  { id: 'userEnumeration', severity: 'low', knowledge: 'auth.authentication', check: (w) => hasEp(w, 'login') && String(w.app.authErrors ?? 'generic') === 'specific' },
  { id: 'cookieNoHttpOnly', severity: 'medium', knowledge: 'auth.cookie', check: (w) => String(w.app.authMode) === 'session' && w.app.cookieHttpOnly !== true && hasEp(w, 'reviews') },
  { id: 'publicBackupFile', severity: 'critical', knowledge: 'sec.secrets', check: (w) => w.files.some((f) => f.path.startsWith('/var/www/html/') && f.kind === 'sql') },
];

export const SEVERITY_WEIGHT: Record<Severity, number> = { low: 4, medium: 8, high: 15, critical: 25 };

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function computeVulns(w: World, content: ContentBundle): string[] {
  return VULNS.filter((v) => v.check(w, content)).map((v) => v.id);
}

export function vulnDef(id: string): VulnDef | undefined {
  return VULNS.find((v) => v.id === id);
}

/** Run an Attack Lab scenario step by step against the current system. */
export function runAttack(attack: AttackDef, facts: Facts, at: number, seq: number): AttackResult {
  const steps: AttackResult['steps'] = [];
  let blockedAt: string | null = null;
  for (const step of attack.steps) {
    if (blockedAt) {
      steps.push({ id: step.id, status: 'skipped' });
      continue;
    }
    if (evaluate(step.blockedWhen, facts)) {
      blockedAt = step.id;
      steps.push({ id: step.id, status: 'blocked' });
    } else {
      steps.push({ id: step.id, status: 'passed' });
    }
  }
  return { attackId: attack.id, success: blockedAt === null, blockedAt, steps, at, seq };
}

export function knownVulns(state: GameState, vulns: string[]): string[] {
  return vulns.filter((id) => {
    const def = vulnDef(id);
    if (!def) return false;
    const k = state.knowledge[def.knowledge];
    return !!k && k.state !== 'locked';
  });
}
