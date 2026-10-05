import type { RegionId } from '../types';

/** Round-trip times between regions (ms), including the user's last mile. */
const RTT: Record<RegionId, Record<RegionId, number>> = {
  eu: { eu: 20, us: 100, ap: 180 },
  us: { eu: 100, us: 20, ap: 150 },
  ap: { eu: 180, us: 150, ap: 20 },
};

/** Backbone RTT between data centres (no last mile). */
const DC_RTT: Record<RegionId, Record<RegionId, number>> = {
  eu: { eu: 1, us: 85, ap: 160 },
  us: { eu: 85, us: 1, ap: 135 },
  ap: { eu: 160, us: 135, ap: 1 },
};

export function rtt(user: RegionId, server: RegionId): number {
  return RTT[user]?.[server] ?? 150;
}

export function dcRtt(a: RegionId, b: RegionId): number {
  return DC_RTT[a]?.[b] ?? 150;
}

export interface NetProfile {
  rttMult: number;
  bandwidthMbps: number;
}

export const DESKTOP: NetProfile = { rttMult: 1, bandwidthMbps: 25 };
export const MOBILE: NetProfile = { rttMult: 3, bandwidthMbps: 2 };

/**
 * Network time of one HTTP request: a request/response round trip, plus the share of
 * requests that open a new connection (TCP handshake + TLS handshake), plus transfer time.
 */
export function requestNetworkMs(opts: {
  rttMs: number;
  tls: boolean;
  tlsVersion: '1.2' | '1.3';
  resumption: boolean;
  responseKb: number;
  bandwidthMbps: number;
  newConnShare?: number;
}): number {
  const newConn = opts.newConnShare ?? 0.3;
  const tlsRtts = opts.tls ? (opts.tlsVersion === '1.3' ? 1 : 2) * (opts.resumption ? 0.5 : 1) : 0;
  const handshake = newConn * (1 + tlsRtts) * opts.rttMs;
  const transfer = ((opts.responseKb * 8) / (opts.bandwidthMbps * 1000)) * 1000;
  return opts.rttMs + handshake + transfer;
}
