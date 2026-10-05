/**
 * Simulated terminal. Only a fixed set of read-only commands exists; output is generated
 * from the game state and the latest simulation. Nothing is executed anywhere.
 */
import { maybeComponent } from '../catalog';
import { explainQuery } from '../sim/db';
import type { SimResult } from '../sim/types';
import type { ContentBundle, GameState } from '../types';
import { clockParts, round } from '../util';
import type { EvidenceToken } from '../types';

export interface TerminalOutput {
  lines: string[];
  /** evidence token the output can be pinned as */
  pin?: EvidenceToken;
  error?: boolean;
}

export const ALLOWED_COMMANDS = ['help', 'ping', 'curl', 'dig', 'ss', 'top', 'free', 'df', 'tail', 'systemctl', 'git', 'redis-cli', 'mysql', 'openssl', 'traceroute', 'whoami', 'date', 'clear', 'ls', 'cat'] as const;

function parse(input: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

export function runCommand(input: string, state: GameState, content: ContentBundle, sim: SimResult | null): TerminalOutput {
  const argv = parse(input.trim());
  if (!argv.length) return { lines: [] };
  const [cmd, ...args] = argv;
  if (!(ALLOWED_COMMANDS as readonly string[]).includes(cmd)) {
    return { lines: [`prod-sh: ${cmd}: command not found (type "help" for the list of available commands)`], error: true };
  }
  if (!state.unlocks.commands.includes(cmd) && !['help', 'clear', 'whoami', 'date', 'ls', 'cat'].includes(cmd)) {
    return { lines: [`prod-sh: ${cmd}: not available yet`], error: true };
  }
  const w = state.world;
  const role = (type: string) => maybeComponent(content, type)?.role;
  const findHost = (host?: string) => {
    if (!host) return undefined;
    const clean = host.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
    return w.nodes.find((n) => n.ip === clean || n.name.toLowerCase() === clean.toLowerCase() || n.id === clean);
  };

  switch (cmd) {
    case 'help':
      return {
        lines: [
          'Available commands (simulated, read-only):',
          ...state.unlocks.commands.map((c) => {
            const def = content.commands.find((x) => x.id === c);
            return `  ${def?.usage.padEnd(34) ?? c.padEnd(34)} ${def?.description.en ?? ''}`;
          }),
          '  ls <dir> / cat <file>             browse project files',
          '  clear                             clear the screen',
        ],
      };
    case 'whoami':
      return { lines: ['dev'] };
    case 'date': {
      const p = clockParts(state.clock);
      return { lines: [`Day ${p.day}, ${p.hh.toString().padStart(2, '0')}:${p.mm.toString().padStart(2, '0')} UTC`] };
    }
    case 'clear':
      return { lines: ['\u001bclear'] };
    case 'ls': {
      const dir = (args[0] ?? '/var/www/html').replace(/\/$/, '');
      const files = w.files.filter((f) => f.path.startsWith(dir + '/') && !f.path.slice(dir.length + 1).includes('/'));
      if (!files.length) return { lines: [`ls: cannot access '${dir}': No such file or directory`], error: true };
      return { lines: files.map((f) => `${f.secret ? '-rw-------' : '-rw-r--r--'} ${String(Math.round(f.sizeKb * 1024)).padStart(9)} ${f.path.split('/').pop()}`) };
    }
    case 'cat': {
      const f = w.files.find((x) => x.path === args[0]);
      if (!f) return { lines: [`cat: ${args[0] ?? ''}: No such file or directory`], error: true };
      if (f.kind === 'image') return { lines: ['(binary image data)'] };
      return { lines: (f.content ?? '').split('\n'), pin: { app: 'terminal', kind: 'file', key: f.path } };
    }
    case 'ping': {
      const host = args[0];
      let node = findHost(host);
      if (!node && host && state.company.domain && host.includes(state.company.domain)) {
        const a = w.dns.records.find((r) => r.name === '@' && r.type === 'A');
        node = a ? w.nodes.find((n) => n.ip === a.value) : undefined;
        if (!a) return { lines: [`ping: ${host}: Name or service not known`], error: true, pin: { app: 'terminal', kind: 'cmd', key: 'ping:nxdomain' } };
      }
      if (!node || node.offline) return { lines: [`PING ${host ?? '?'}: 4 packets transmitted, 0 received, 100% packet loss`], pin: { app: 'terminal', kind: 'cmd', key: 'ping:down' } };
      return {
        lines: [`PING ${node.ip}: 56 data bytes`, ...[0, 1, 2].map((i) => `64 bytes from ${node!.ip}: icmp_seq=${i} ttl=57 time=${(18 + i * 0.7).toFixed(1)} ms`), '3 packets transmitted, 3 received, 0% packet loss'],
        pin: { app: 'terminal', kind: 'cmd', key: 'ping:ok' },
      };
    }
    case 'curl': {
      const url = args.find((a) => !a.startsWith('-')) ?? '';
      const head = args.includes('-I');
      return curl(url, head, state, content, sim);
    }
    case 'dig': {
      const name = args[0] ?? state.company.domain ?? '';
      const type = (args[1] ?? 'A').toUpperCase();
      if (!w.dns.domain || !name.endsWith(w.dns.domain)) return { lines: [`;; ->>HEADER<<- status: NXDOMAIN`, `;; QUESTION: ${name}. IN ${type}`], pin: { app: 'terminal', kind: 'dns', key: 'nxdomain' } };
      const sub = name === w.dns.domain ? '@' : name.slice(0, -(w.dns.domain.length + 1));
      const recs = w.dns.records.filter((r) => r.name === sub && (r.type === type || r.type === 'CNAME'));
      if (!recs.length) return { lines: [';; ->>HEADER<<- status: NXDOMAIN', `;; QUESTION: ${name}. IN ${type}`], pin: { app: 'terminal', kind: 'dns', key: `nxdomain:${sub}` } };
      const change = [...w.dns.changes].reverse().find((c) => c.name === sub && c.type === type);
      const lines = [';; ->>HEADER<<- status: NOERROR', ';; ANSWER SECTION:', ...recs.map((r) => `${name}.\t${r.ttl}\tIN\t${r.type}\t${r.value}`)];
      if (change && change.oldValue && (state.clock - change.at) * 60 < change.oldTtl) {
        lines.push(`;; note: resolvers that cached the old answer still return ${change.oldValue} for up to ${Math.round((change.oldTtl - (state.clock - change.at) * 60) / 60)} more minutes`);
      }
      return { lines, pin: { app: 'terminal', kind: 'dns', key: `${sub}:${type}` } };
    }
    case 'ss': {
      const host = findHost(args.find((a) => !a.startsWith('-'))) ?? w.nodes.find((n) => role(n.type) === 'proxy') ?? w.nodes.find((n) => role(n.type) === 'backend');
      const servers = w.nodes.filter((n) => n.ip === host?.ip && role(n.type) !== 'client');
      const lines = ['State   Local Address:Port   Process'];
      for (const n of servers) for (const p of n.ports) lines.push(`LISTEN  0.0.0.0:${String(p).padEnd(16)} ${n.type === 'nginx' ? 'nginx' : n.type === 'mysql' ? 'mysqld' : n.type === 'redis' ? 'redis-server' : n.type === 'backend' ? 'php-fpm/app' : n.type}`);
      lines.push('', `Firewall (public): ${[...new Set(servers.flatMap((n) => n.publicPorts))].sort((a, b) => a - b).join(', ') || 'none'}`);
      return { lines, pin: { app: 'terminal', kind: 'ports', key: servers.flatMap((n) => n.ports).sort().join(',') } };
    }
    case 'top':
    case 'free': {
      const host = findHost(args[0]) ?? w.nodes.find((n) => role(n.type) === 'backend') ?? w.nodes.find((n) => role(n.type) === 'proxy');
      if (!host) return { lines: ['no host'], error: true };
      const ns = sim?.nodes[host.id];
      const cpu = ns ? ns.cpu : 3;
      const ram = ns ? ns.ram : 30;
      if (cmd === 'free') {
        const def = maybeComponent(content, host.type);
        const total = (def?.ramMb ?? 1024) * ({ s: 1, m: 2, l: 4, xl: 8, '2xl': 16 }[host.size] ?? 1);
        return { lines: ['              total        used        free', `Mem:   ${String(total).padStart(12)} ${String(Math.round((total * ram) / 100)).padStart(11)} ${String(Math.round(total * (1 - ram / 100))).padStart(11)}`], pin: { app: 'terminal', kind: 'ram', key: `${host.id}:${ram >= 85 ? 'high' : 'ok'}` } };
      }
      return {
        lines: [
          `top - ${host.name} (${host.ip})`,
          `%Cpu(s): ${round(cpu, 1)} us   load average: ${round((cpu / 100) * 2, 2)}`,
          `MiB Mem: ${round(ram, 1)}% used`,
          ns?.status === 'offline' ? '!! host unreachable' : `  PID USER   %CPU %MEM COMMAND`,
          ns?.status === 'offline' ? '' : ` 2741 www    ${round(cpu * 0.8, 1).toString().padStart(4)} ${round(ram * 0.7, 1).toString().padStart(4)} ${host.type === 'mysql' ? 'mysqld' : host.type === 'nginx' ? 'nginx: worker' : 'php-fpm: pool www'}`,
        ],
        pin: { app: 'terminal', kind: 'cpu', key: `${host.type}:${cpu >= 85 ? 'high' : cpu >= 60 ? 'medium' : 'low'}` },
      };
    }
    case 'df': {
      const pct = Number(w.flags.diskUsedPct ?? 38);
      return { lines: ['Filesystem  Size  Used Avail Use% Mounted on', `/dev/vda1    40G  ${round((40 * pct) / 100, 1)}G  ${round(40 - (40 * pct) / 100, 1)}G  ${pct}% /`], pin: { app: 'terminal', kind: 'disk', key: pct >= 90 ? 'full' : 'ok' } };
    }
    case 'tail': {
      const file = args.find((a) => !a.startsWith('-')) ?? '/var/log/nginx/error.log';
      if (!sim) return { lines: ['(no data yet — run a simulation)'] };
      const src = file.includes('nginx') ? 'proxy' : file.includes('mysql') ? 'database' : file.includes('worker') ? 'worker' : 'backend';
      const lines = sim.logs
        .filter((l) => (src === 'proxy' ? ['nginx', 'lb'].includes(l.sourceType) || l.sourceType === 'proxy' : src === 'database' ? l.sourceType === 'mysql' : src === 'worker' ? l.sourceType === 'worker' : l.sourceType === 'backend' || l.sourceType === 'kernel'))
        .filter((l) => (file.includes('error') ? l.level !== 'INFO' : true))
        .slice(-20)
        .map((l) => {
          const p = clockParts(l.t + l.tz * 60);
          return `${p.hhmm} ${l.level.padEnd(5)} ${l.requestId ? `[${l.requestId}] ` : ''}${l.message}`;
        });
      return { lines: lines.length ? lines : ['(empty)'], pin: { app: 'terminal', kind: 'tail', key: file } };
    }
    case 'systemctl': {
      const unit = args[1] ?? args[0] ?? 'nginx';
      const node = w.nodes.find((n) => n.type === unit || n.name.toLowerCase().includes(unit.toLowerCase()) || (unit === 'app' && role(n.type) === 'backend'));
      if (!node) return { lines: [`Unit ${unit}.service could not be found.`], error: true };
      const ns = sim?.nodes[node.id];
      const crashed = ns && (ns.status === 'offline' || ns.reasons.includes('crashed'));
      const restart = node.config.autoRestart === true || state.world.app.autoRestart === true;
      return {
        lines: [
          `● ${unit}.service`,
          `   Active: ${node.offline ? 'inactive (dead)' : crashed && !restart ? 'failed (Result: oom-kill)' : 'active (running)'}`,
          `   Restart=${restart ? 'always' : 'no'}`,
          crashed ? '   kernel: Out of memory: Killed process 2741' : '',
        ].filter(Boolean),
        pin: { app: 'terminal', kind: 'service', key: `${node.type}:${node.offline ? 'dead' : crashed ? 'oom' : 'running'}` },
      };
    }
    case 'git': {
      if (!w.git.initialized) return { lines: ['fatal: not a git repository (or any of the parent directories): .git'], error: true };
      if (args[0] === 'log') {
        const lines = w.git.commits.slice(-15).reverse().map((c) => `${c.id} ${c.branch.padEnd(14)} ${c.message}${c.secret ? '   (+ .env)' : ''}`);
        return { lines, pin: { app: 'terminal', kind: 'git', key: 'log' } };
      }
      return { lines: [`On branch ${w.git.current}`, `${Object.keys(w.deploy.pending).length} change(s) waiting for deploy`] };
    }
    case 'redis-cli': {
      const r = w.nodes.find((n) => role(n.type) === 'cache');
      if (!r) return { lines: ['Could not connect to Redis at 127.0.0.1:6379: Connection refused'], error: true };
      const ns = sim?.nodes[r.id];
      return {
        lines: ['# Memory', `used_memory_human:${round(ns?.memoryUsedMb ?? 0, 1)}M`, `maxmemory_human:${r.config.memoryMb ?? 256}M`, `maxmemory_policy:${r.config.maxmemoryPolicy ?? 'noeviction'}`, '# Stats', `keyspace_hit_ratio:${sim?.summary.cacheHitRate !== null && sim ? round((sim.summary.cacheHitRate ?? 0) * 100, 1) : 0}%`],
        pin: { app: 'terminal', kind: 'redis', key: (ns?.memoryUsedMb ?? 0) >= Number(r.config.memoryMb ?? 256) ? 'full' : 'ok' },
      };
    }
    case 'mysql': {
      const db = w.nodes.find((n) => role(n.type) === 'database');
      if (!db) return { lines: ["ERROR 2002 (HY000): Can't connect to local MySQL server"], error: true };
      const q = args.join(' ');
      if (/processlist/i.test(q)) {
        const conns = sim?.nodes[db.id]?.connections ?? 0;
        return { lines: [`Threads_connected: ${conns}`, `max_connections: ${db.config.maxConnections ?? 151}`], pin: { app: 'terminal', kind: 'db', key: conns >= Number(db.config.maxConnections ?? 151) ? 'connections-full' : 'connections-ok' } };
      }
      const ep = w.endpoints.find((e) => q.includes(e.id)) ?? w.endpoints.find((e) => e.queries.length && !e.disabled);
      if (!ep || !ep.queries.length) return { lines: ['Empty set'] };
      const ex = explainQuery(ep.queries[0], w.tables);
      return {
        lines: ['id | select_type | table | type | possible_keys | key | rows | Extra', `1  | SIMPLE      | ${ex.table} | ${ex.type} | ${ex.possibleKeys.join(',') || 'NULL'} | ${ex.key ?? 'NULL'} | ${ex.rows} | ${ex.extra.join('; ')}`],
        pin: { app: 'terminal', kind: 'explain', key: `${ex.table}:${ex.type}` },
      };
    }
    case 'openssl': {
      if (!w.tls.enabled) return { lines: ['connect: Connection refused (port 443)'], pin: { app: 'terminal', kind: 'tls', key: 'none' } };
      const days = w.tls.expiresAt === null ? 0 : Math.floor((w.tls.expiresAt - state.clock) / 1440);
      return {
        lines: [`subject=CN = ${state.company.domain}`, `issuer=${w.tls.issuer === 'letsencrypt' ? "C = US, O = Let's Encrypt, CN = R11" : `CN = ${state.company.domain} (self-signed)`}`, `notAfter: in ${days} days${days < 0 ? '  (EXPIRED)' : ''}`, `Protocol: TLSv${w.tls.version}`],
        pin: { app: 'terminal', kind: 'tls', key: days < 0 ? 'expired' : days < 14 ? 'expiring' : 'ok' },
      };
    }
    case 'traceroute': {
      const lines = [' 1  home-router (192.168.1.1)  1.2 ms', ' 2  isp-gw  8.4 ms', ' 3  ix-frankfurt  14.9 ms'];
      const entry = w.nodes.find((n) => role(n.type) === 'cdn') ?? w.nodes.find((n) => role(n.type) === 'lb') ?? w.nodes.find((n) => role(n.type) === 'proxy');
      lines.push(` 4  ${entry?.name ?? 'server'} (${entry?.ip ?? '?'})  19.8 ms`);
      return { lines };
    }
  }
  return { lines: [] };
}

function curl(url: string, head: boolean, state: GameState, content: ContentBundle, sim: SimResult | null): TerminalOutput {
  const w = state.world;
  if (!url) return { lines: ['curl: no URL specified'], error: true };
  const m = url.match(/^(https?):\/\/([^/:]+)(?::(\d+))?(\/.*)?$/);
  if (!m) return { lines: [`curl: (3) URL rejected: ${url}`], error: true };
  const [, scheme, host, portStr, pathRaw] = m;
  const path = pathRaw ?? '/';
  const port = portStr ? Number(portStr) : scheme === 'https' ? 443 : 80;
  let ip = host;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    if (!w.dns.domain || !host.endsWith(w.dns.domain)) return { lines: [`curl: (6) Could not resolve host: ${host}`], pin: { app: 'terminal', kind: 'curl', key: 'resolve' } };
    const sub = host === w.dns.domain ? '@' : host.slice(0, -(w.dns.domain.length + 1));
    const rec = w.dns.records.find((r) => r.name === sub);
    if (!rec) return { lines: [`curl: (6) Could not resolve host: ${host}`], pin: { app: 'terminal', kind: 'curl', key: 'resolve' } };
    const a = rec.type === 'CNAME' ? w.dns.records.find((r) => r.name === '@' && r.type === 'A') : rec;
    ip = a?.value ?? '';
  }
  const hosts = w.nodes.filter((n) => n.ip === ip && !n.offline);
  if (!hosts.length) return { lines: [`curl: (28) Failed to connect to ${host} port ${port}: Connection timed out`], pin: { app: 'terminal', kind: 'curl', key: 'timeout' } };
  const listening = hosts.find((n) => n.ports.includes(port) || (n.config.listenPort === port));
  if (!listening) return { lines: [`curl: (7) Failed to connect to ${host} port ${port}: Connection refused`], pin: { app: 'terminal', kind: 'curl', key: `refused:${port}` } };
  if (!listening.publicPorts.includes(port)) return { lines: [`curl: (28) Failed to connect to ${host} port ${port}: Connection timed out (firewall)`], pin: { app: 'terminal', kind: 'curl', key: `firewall:${port}` } };
  if (scheme === 'https') {
    if (!w.tls.enabled) return { lines: [`curl: (35) SSL connect error`], pin: { app: 'terminal', kind: 'curl', key: 'tls-none' } };
    if (w.tls.expiresAt !== null && state.clock >= w.tls.expiresAt) return { lines: ['curl: (60) SSL certificate problem: certificate has expired'], pin: { app: 'terminal', kind: 'curl', key: 'tls-expired' } };
  }
  const ep = w.endpoints.find((e) => e.path === path && !e.disabled) ?? w.endpoints.find((e) => path.startsWith(e.path.replace(/\/:.*$/, '')) && e.path !== '/' && !e.disabled);
  const asset = w.files.find((f) => f.path === `/var/www/html${path === '/' ? '/index.html' : path}`);
  let status = 200;
  let ctype = 'text/html; charset=utf-8';
  let size = 1;
  if (ep) {
    const s = sim?.endpoints[ep.id];
    status = s?.status ?? 200;
    if (s && s.errorRate > 0.3) status = s.status;
    ctype = ep.api ? 'application/json' : 'text/html; charset=utf-8';
    size = ep.responseKb;
  } else if (asset) {
    size = asset.sizeKb;
    ctype = asset.kind === 'image' ? 'image/*' : asset.kind === 'css' ? 'text/css' : 'text/html';
  } else {
    status = 404;
  }
  if (scheme === 'http' && w.tls.enabled && w.tls.redirectHttp && port === 80) status = 301;
  const lines = [`HTTP/1.1 ${status} ${statusText(status)}`, `Server: ${listening.type === 'nginx' ? 'nginx/1.26' : 'app'}`, `Content-Type: ${ctype}`, `Content-Length: ${Math.round(size * 1024)}`];
  if (status === 301) lines.push(`Location: https://${host}${path}`);
  if (w.tls.enabled && w.tls.hsts && scheme === 'https') lines.push('Strict-Transport-Security: max-age=31536000');
  if (!head && ep?.example !== undefined) lines.push('', JSON.stringify(ep.example, null, 2));
  void content;
  return { lines, pin: { app: 'terminal', kind: 'curl', key: `${status}:${path}` } };
}

function statusText(s: number): string {
  return (
    { 200: 'OK', 201: 'Created', 301: 'Moved Permanently', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Not Allowed', 422: 'Unprocessable Content', 429: 'Too Many Requests', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout' } as Record<number, string>
  )[s] ?? '';
}
