import {describe, expect, it} from 'vitest';
import {parseEdgeWordBoundaryMessage} from './edge-tts.js';

describe('Edge TTS word boundaries', () => {
  it('converts provider 100ns offsets into ordered seconds', () => {
    const message = [
      'X-RequestId:test',
      'Content-Type:application/json; charset=utf-8',
      'Path:audio.metadata',
      '',
      JSON.stringify({
        Metadata: [{
          Type: 'WordBoundary',
          Data: {
            Offset: 1_000_000,
            Duration: 2_875_000,
            text: {Text: 'One', BoundaryType: 'WordBoundary'},
          },
        }],
      }),
    ].join('\r\n');

    expect(parseEdgeWordBoundaryMessage(message)).toEqual([
      {word: 'One', start: 0.1, end: 0.3875},
    ]);
    expect(parseEdgeWordBoundaryMessage('Path:turn.end\r\n\r\n')).toEqual([]);
  });
});
