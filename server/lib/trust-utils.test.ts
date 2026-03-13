import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LOOPBACK_RE, getRealClientIp, isRequestTrusted, canInjectGatewayToken } from './trust-utils.js';
import { config } from './config.js';

vi.mock('./config.js', () => ({
  config: {
    auth: false,
    gatewayToken: 'test-token',
  },
}));

describe('trust-utils', () => {
  beforeEach(() => {
    (config as any).auth = false; // eslint-disable-line @typescript-eslint/no-explicit-any
    (config as any).gatewayToken = 'test-token'; // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  describe('LOOPBACK_RE', () => {
    it('matches IPv4 loopback', () => {
      expect(LOOPBACK_RE.test('127.0.0.1')).toBe(true);
      expect(LOOPBACK_RE.test('127.255.0.0')).toBe(true);
    });

    it('matches IPv6 loopback', () => {
      expect(LOOPBACK_RE.test('::1')).toBe(true);
      expect(LOOPBACK_RE.test('::ffff:127.0.0.1')).toBe(true);
    });

    it('rejects external addresses', () => {
      expect(LOOPBACK_RE.test('1.1.1.1')).toBe(false);
      expect(LOOPBACK_RE.test('2001:4860:4860::8888')).toBe(false);
    });
  });

  describe('getRealClientIp', () => {
    it('returns direct IP when no forward headers are present', () => {
      const req = { socket: { remoteAddress: '192.168.1.1' }, headers: {} };
      expect(getRealClientIp(req)).toBe('192.168.1.1');
    });

    it('returns direct IP when headers exist but direct connection is not loopback', () => {
      const req = { 
        socket: { remoteAddress: '192.168.1.1' }, 
        headers: { 'x-forwarded-for': '203.0.113.5' } 
      };
      expect(getRealClientIp(req)).toBe('192.168.1.1');
    });

    it('resolves X-Forwarded-For when direct connection is loopback', () => {
      const req = { 
        socket: { remoteAddress: '127.0.0.1' }, 
        headers: { 'x-forwarded-for': '203.0.113.5' } 
      };
      expect(getRealClientIp(req)).toBe('203.0.113.5');
    });

    it('handles multiple IPs in X-Forwarded-For', () => {
      const req = { 
        socket: { remoteAddress: '::1' }, 
        headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2' } 
      };
      expect(getRealClientIp(req)).toBe('1.1.1.1');
    });

    it('falls back to X-Real-IP if X-Forwarded-For is missing', () => {
      const req = { 
        socket: { remoteAddress: '127.0.0.1' }, 
        headers: { 'x-real-ip': '1.1.1.1' } 
      };
      expect(getRealClientIp(req)).toBe('1.1.1.1');
    });
  });

  describe('isRequestTrusted', () => {
    it('is trusted if global auth is enabled regardless of IP', () => {
      (config as any).auth = true; // eslint-disable-line @typescript-eslint/no-explicit-any
      const req = { socket: { remoteAddress: '8.8.8.8' }, headers: {} };
      expect(isRequestTrusted(req)).toBe(true);
    });

    it('is trusted if IP is loopback and auth is disabled', () => {
      (config as any).auth = false; // eslint-disable-line @typescript-eslint/no-explicit-any
      const req = { socket: { remoteAddress: '127.0.0.1' }, headers: {} };
      expect(isRequestTrusted(req)).toBe(true);
    });

    it('is NOT trusted if IP is external and auth is disabled', () => {
      (config as any).auth = false; // eslint-disable-line @typescript-eslint/no-explicit-any
      const req = { socket: { remoteAddress: '8.8.8.8' }, headers: {} };
      expect(isRequestTrusted(req)).toBe(false);
    });

    it('is NOT trusted if direct loopback is a proxy for an external user', () => {
      (config as any).auth = false; // eslint-disable-line @typescript-eslint/no-explicit-any
      const req = { 
        socket: { remoteAddress: '127.0.0.1' }, 
        headers: { 'x-forwarded-for': '8.8.8.8' } 
      };
      expect(isRequestTrusted(req)).toBe(false);
    });
  });

  describe('canInjectGatewayToken', () => {
    it('returns true for trusted loopback with token', () => {
      const req = { socket: { remoteAddress: '127.0.0.1' }, headers: {} };
      expect(canInjectGatewayToken(req)).toBe(true);
    });

    it('returns false if gateway token is missing', () => {
      (config as any).gatewayToken = ''; // eslint-disable-line @typescript-eslint/no-explicit-any
      const req = { socket: { remoteAddress: '127.0.0.1' }, headers: {} };
      expect(canInjectGatewayToken(req)).toBe(false);
    });

    it('returns false if request is not trusted', () => {
      const req = { socket: { remoteAddress: '8.8.8.8' }, headers: {} };
      expect(canInjectGatewayToken(req)).toBe(false);
    });
  });
});
