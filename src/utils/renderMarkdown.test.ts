/** renderMarkdown: the regex renderer behind the streaming preview and tool row descriptions. */
import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './helpers';

describe('renderMarkdown', () => {
  it('renders normal markdown as before', () => {
    expect(renderMarkdown('Use **bold**, *italic*, `code` and [docs](https://example.com/a_b).\n- one\n* two\nend')).toBe(
      'Use <strong>bold</strong>, <em>italic</em>, <code>code</code> and '
      + '<a href="https://example.com/a_b" target="_blank" rel="noopener noreferrer">docs</a>.<br>• one<br>• two<br>end',
    );
    expect(renderMarkdown('Before\n```js\nconst a = 1;\n\nconst b = 2;\n```\nAfter')).toBe(
      'Before<br><pre class="hljs"><span class="code-lang">js</span><code>const a = 1;\n\nconst b = 2;\n</code></pre><br>After',
    );
    expect(renderMarkdown('<b>x</b> & "q"')).toBe('&lt;b&gt;x&lt;/b&gt; &amp; &quot;q&quot;');
    expect(renderMarkdown('**a `x` b**')).toBe('<strong>a <code>x</code> b</strong>');
    // A fence still being streamed is text until it closes
    expect(renderMarkdown('```\nunterminated **x**')).toBe('```<br>unterminated <strong>x</strong>');
  });

  it('keeps a fenced block verbatim: no bold, italic, code, links, bullets or line breaks inside it', () => {
    const inside = 'see **bold**, *it*, `code` and [label](https://example.com/x)\n- not a bullet\n<b>raw</b>';

    expect(renderMarkdown('```\n' + inside + '\n```')).toBe(
      '<pre class="hljs"><code>see **bold**, *it*, `code` and [label](https://example.com/x)\n- not a bullet\n&lt;b&gt;raw&lt;/b&gt;\n</code></pre>',
    );
  });

  it('closes a longer fence only on a fence of the same length, so a fence inside it stays text', () => {
    const inside = 'before\n```js\nconst x = **1**;\n```\nafter';

    expect(renderMarkdown('**tool result:**\n````\n' + inside + '\n````')).toBe(
      '<strong>tool result:</strong><br><pre class="hljs"><code>' + inside + '\n</code></pre>',
    );
  });

  it('keeps inline code verbatim', () => {
    expect(renderMarkdown('run `**not bold** [x](https://a.b)` now')).toBe(
      'run <code>**not bold** [x](https://a.b)</code> now',
    );
  });
});
