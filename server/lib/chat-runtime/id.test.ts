import { describe, expect, it } from 'vitest';
import {
  assistantItemId,
  assistantSegmentItemId,
  fingerprintText,
  thinkingItemId,
  toolCallItemId,
  toolGroupItemId,
  turnId,
  userItemId,
} from './id.js';

describe('chat runtime ids', () => {
  it('creates stable IDs from session and run identifiers', () => {
    expect(turnId('agent:main:main', 'run-1')).toBe('turn:agent:main:main:run-1');
    expect(assistantItemId('agent:main:main', 'run-1')).toBe('assistant:agent:main:main:run-1:answer');
    expect(toolCallItemId('agent:main:main', 'run-1', 'tool-7')).toBe('tool:agent:main:main:run-1:tool-7');
    expect(toolGroupItemId('agent:main:main', 'run-1', 2)).toBe('tool-group:agent:main:main:run-1:2');
    expect(thinkingItemId('agent:main:main', 'run-1', 0)).toBe('thinking:agent:main:main:run-1:0');
  });

  it('creates stable assistant segment IDs without changing the default assistant ID', () => {
    expect(assistantItemId('agent:main:main', 'run-1')).toBe('assistant:agent:main:main:run-1:answer');
    expect(assistantSegmentItemId('agent:main:main', 'run-1', 0)).toBe('assistant:agent:main:main:run-1:segment:0');
    expect(assistantSegmentItemId('agent:main:main', 'run-1', 1)).toBe('assistant:agent:main:main:run-1:segment:1');
    expect(assistantSegmentItemId('agent:main:main', 'run-1', 0)).not.toBe(assistantItemId('agent:main:main', 'run-1'));
  });

  it('uses gateway message id for user items when present', () => {
    expect(userItemId({ sessionKey: 'agent:main:main', messageId: 'msg-1' })).toBe('user:agent:main:main:msg-1');
  });

  it('uses idempotency key for optimistic user items', () => {
    expect(userItemId({ sessionKey: 'agent:main:main', idempotencyKey: 'ik-1' })).toBe('user:agent:main:main:ik-1');
  });

  it('prefers message id over idempotency and fallback fields', () => {
    expect(userItemId({
      sessionKey: 'agent:main:main',
      messageId: 'msg-1',
      idempotencyKey: 'ik-1',
      text: 'hello world',
      timestamp: 123,
      fallbackIndex: 7,
    })).toBe('user:agent:main:main:msg-1');
  });

  it('uses a stable fallback index to disambiguate replayed user items', () => {
    const first = userItemId({
      sessionKey: 'agent:main:main',
      text: 'hello world',
      timestamp: 123,
      fallbackIndex: 0,
    });
    const second = userItemId({
      sessionKey: 'agent:main:main',
      text: ' hello\nworld ',
      timestamp: 123,
      fallbackIndex: 1,
    });

    expect(first).not.toBe(second);
    expect(first).toBe(userItemId({
      sessionKey: 'agent:main:main',
      text: 'hello world',
      timestamp: 123,
      fallbackIndex: 0,
    }));
  });

  it('keeps fallback user ids deterministic without a fallback index', () => {
    expect(userItemId({
      sessionKey: 'agent:main:main',
      text: ' hello\nworld ',
      timestamp: Number.NaN,
    })).toBe(userItemId({
      sessionKey: 'agent:main:main',
      text: 'hello world',
    }));
  });

  it('encodes delimiter-containing run ids so tuple boundaries do not collide', () => {
    expect(turnId('agent:main:main', 'run:1')).not.toBe(turnId('agent:main:main:run', '1'));
    expect(assistantItemId('agent:main:main', 'run:1')).not.toBe(assistantItemId('agent:main:main:run', '1'));
    expect(assistantSegmentItemId('agent:main:main', 'run:1', 0)).not.toBe(
      assistantSegmentItemId('agent:main:main:run', '1', 0),
    );
    expect(toolGroupItemId('agent:main:main', 'run:1', 2)).not.toBe(toolGroupItemId('agent:main:main:run', '1', 2));
    expect(thinkingItemId('agent:main:main', 'run:1', 0)).not.toBe(thinkingItemId('agent:main:main:run', '1', 0));
  });

  it('encodes delimiter-containing tool call ids so tuple boundaries do not collide', () => {
    expect(toolCallItemId('agent:main:main', 'run:1', 'tool')).not.toBe(
      toolCallItemId('agent:main:main', 'run', '1:tool'),
    );
  });

  it('encodes delimiter-containing user identity suffixes so tuple boundaries do not collide', () => {
    expect(userItemId({ sessionKey: 'agent:main:main', messageId: 'msg:1' })).not.toBe(
      userItemId({ sessionKey: 'agent:main:main:msg', messageId: '1' }),
    );
    expect(userItemId({ sessionKey: 'agent:main:main', idempotencyKey: 'ik:1' })).not.toBe(
      userItemId({ sessionKey: 'agent:main:main:ik', idempotencyKey: '1' }),
    );
  });

  it('fingerprints normalized text deterministically', () => {
    expect(fingerprintText(' hello\n\nworld ')).toBe(fingerprintText('hello world'));
    expect(fingerprintText('hello world')).not.toBe(fingerprintText('hello there'));
  });
});
