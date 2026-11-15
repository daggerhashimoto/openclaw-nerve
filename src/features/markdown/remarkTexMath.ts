/**
 * TeX math syntax for the markdown renderer: `$...$`, `$$...$$`, `\(...\)` and
 * `\[...\]`, as a micromark extension plus the matching mdast builders.
 *
 * Why not remark-math: its single-dollar rule pairs any two dollars in a
 * paragraph, so agent prose such as "this run cost $5 and the next one $10"
 * turned into a formula. Single-dollar math here follows Pandoc's
 * `tex_math_dollars` rule instead: the opening `$` must be followed by a
 * non-space character, the closing `$` must be preceded by a non-space
 * character and must not be followed by a digit, and the first unescaped `$`
 * after the opener is the only closing candidate. When the rule fails the
 * opener stays plain text and parsing resumes on the next character, so
 * "paid $5 for $x^2$ lessons" still renders `x^2`.
 *
 * Working inside the tokenizer means code spans, code blocks, backslash escapes
 * and container blocks are handled by micromark itself; as with code spans,
 * whichever construct starts first wins. On top of that:
 * - text math never spans a backtick, so a `$` inside a later code span cannot
 *   close an earlier currency `$`;
 * - an expression whose closing delimiter has not arrived yet (streaming) is
 *   plain text;
 * - `$$` or `\[` alone on a line opens a display block that ends at the first
 *   line ending in `$$` or `\]`; a block that never closes is shown as plain
 *   text rather than as a half-typeset formula.
 *
 * Parsing stays linear: when an opener scans to the end of its paragraph (or
 * to a backtick) without finding a closer, every later opener of the same kind
 * before that point would scan a subset of the same text and fail too, so the
 * failure is remembered per tokenizer and those openers fail immediately.
 *
 * The output matches remark-math (`inlineMath` and `math` nodes that become
 * `<code class="language-math math-inline|math-display">`), so rehype-katex
 * typesets it unchanged. `$$...$$` and `\[...\]` inside a paragraph produce
 * display math, as in Pandoc.
 */
import type { Element, Text } from 'hast';
import type { Paragraph, Parent } from 'mdast';
import type { CompileContext, Extension as FromMarkdownExtension } from 'mdast-util-from-markdown';
import type {
  Code,
  Construct,
  Effects,
  Extension as MicromarkExtension,
  State,
  Token,
  TokenizeContext,
} from 'micromark-util-types';
import type { Processor } from 'unified';

declare module 'micromark-util-types' {
  interface TokenTypeMap {
    texMathInline: 'texMathInline';
    texMathDisplay: 'texMathDisplay';
    texMathDelimiter: 'texMathDelimiter';
    texMathValue: 'texMathValue';
    texMathBlock: 'texMathBlock';
    texMathBlockFence: 'texMathBlockFence';
    texMathBlockValue: 'texMathBlockValue';
  }
}

declare module 'mdast-util-from-markdown' {
  interface CompileData {
    /** Fences seen in the current math block: 2 means it was closed. */
    texMathBlockFences?: number | undefined;
  }
}

declare module 'mdast' {
  interface InlineMath extends Literal {
    type: 'inlineMath';
  }

  interface Math extends Literal {
    type: 'math';
  }

  interface RootContentMap {
    inlineMath: InlineMath;
    math: Math;
  }

  interface PhrasingContentMap {
    inlineMath: InlineMath;
  }

  interface BlockContentMap {
    math: Math;
  }
}

// micromark character codes (negative values are its virtual characters).
const LINE_ENDING_MAX = -3; // -5 CR, -4 LF, -3 CRLF
const HORIZONTAL_TAB = -2;
const VIRTUAL_SPACE = -1;
const SPACE = 32;
const DOLLAR = 36;
const LEFT_PAREN = 40;
const RIGHT_PAREN = 41;
const DIGIT_0 = 48;
const DIGIT_9 = 57;
const LEFT_BRACKET = 91;
const BACKSLASH = 92;
const RIGHT_BRACKET = 93;
const BACKTICK = 96;

const isLineEnding = (code: Code): boolean => code !== null && code <= LINE_ENDING_MAX;
const isSpaceOrTab = (code: Code): boolean =>
  code === HORIZONTAL_TAB || code === VIRTUAL_SPACE || code === SPACE;
const isWhitespace = (code: Code): boolean =>
  code !== null && (code < 0 || code === SPACE || /\s/.test(String.fromCharCode(code)));
const isAsciiDigit = (code: Code): boolean => code !== null && code >= DIGIT_0 && code <= DIGIT_9;

/** Consume a run of spaces and tabs (at most `max - 1`) as one token, then continue with `next`. */
function spaceRun(effects: Effects, next: State, type: 'linePrefix' | 'whitespace', max = Infinity): State {
  let size = 0;
  return start;

  function start(code: Code): State | undefined {
    if (isSpaceOrTab(code)) {
      effects.enter(type);
      return inside(code);
    }
    return next(code);
  }

  function inside(code: Code): State | undefined {
    if (isSpaceOrTab(code) && size++ < max - 1) {
      effects.consume(code);
      return inside;
    }
    effects.exit(type);
    return next(code);
  }
}

// ---------------------------------------------------------------------------
// Text math: `$...$`, `$$...$$`, `\(...\)`, `\[...\]` inside a paragraph.
// ---------------------------------------------------------------------------

/** Never start in the middle of a run of dollars (an escaped `\$` does not count as one). */
function previousIsNotDollar(this: TokenizeContext, code: Code): boolean {
  return code !== DOLLAR || this.events[this.events.length - 1][1].type === 'characterEscape';
}

type TextMathKind = 'dollar' | 'doubleDollar' | 'paren' | 'bracket';
type ScannedKind = Exclude<TextMathKind, 'dollar'>;

/**
 * Per text tokenizer (one per paragraph, heading or table cell): for each
 * opener kind, the source range in which an earlier opener of that kind found
 * no closer before the end of the text or the next backtick. A later opener of
 * the same kind inside that range would scan a subset of the same characters,
 * so it fails without scanning again; this keeps a message full of unclosed
 * `\(`, `\[` or `$$` linear. Single dollars need no entry: their scan always
 * stops at the next `$`, so it never overlaps another single-dollar scan.
 */
const unclosedRanges = new WeakMap<TokenizeContext, Partial<Record<ScannedKind, { start: number; end: number }>>>();

function tokenizeTextMath(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  const startOffset = this.now().offset;
  let outer: Token;
  let opener: TextMathKind;
  let openSize = 0;
  let closeSize = 0;
  let pending: Token;
  let afterWhitespace = false;
  let hasContent = false;

  const isDollarOpener = () => opener === 'dollar' || opener === 'doubleDollar';
  const knownUnclosed = (kind: ScannedKind) => {
    const range = unclosedRanges.get(this)?.[kind];
    return range !== undefined && startOffset >= range.start && startOffset < range.end;
  };
  const rememberUnclosed = (kind: ScannedKind) => {
    const ranges = unclosedRanges.get(this) ?? {};
    ranges[kind] = { start: startOffset, end: this.now().offset };
    unclosedRanges.set(this, ranges);
  };

  return start;

  function start(code: Code): State | undefined {
    outer = effects.enter('texMathInline');
    effects.enter('texMathDelimiter');
    if (code === BACKSLASH) {
      effects.consume(code);
      return openBackslash;
    }
    return openDollars(code);
  }

  function openDollars(code: Code): State | undefined {
    if (code === DOLLAR) {
      // Three or more dollars are never a math delimiter.
      if (openSize === 2) return nok(code);
      effects.consume(code);
      openSize += 1;
      return openDollars;
    }
    effects.exit('texMathDelimiter');
    if (openSize === 1) {
      // Pandoc: the opening `$` must be followed by a non-space character.
      if (code === null || isWhitespace(code)) return nok(code);
      opener = 'dollar';
    } else {
      opener = 'doubleDollar';
      outer.type = 'texMathDisplay';
      if (knownUnclosed(opener)) return nok(code);
    }
    return between(code);
  }

  function openBackslash(code: Code): State | undefined {
    if (code === LEFT_PAREN) {
      opener = 'paren';
    } else if (code === LEFT_BRACKET) {
      opener = 'bracket';
      outer.type = 'texMathDisplay';
    } else {
      return nok(code);
    }
    if (knownUnclosed(opener)) return nok(code);
    effects.consume(code);
    effects.exit('texMathDelimiter');
    return between;
  }

  /** Outside a value chunk: at a line ending, a backslash, a possible closing delimiter, or new value text. */
  function between(code: Code): State | undefined {
    // No closing delimiter (yet): plain text. A backtick means a code span
    // starts here, and code spans are never part of math.
    if (code === null || code === BACKTICK) {
      if (opener !== 'dollar') rememberUnclosed(opener);
      return nok(code);
    }
    if (isLineEnding(code)) {
      effects.enter('lineEnding');
      effects.consume(code);
      effects.exit('lineEnding');
      afterWhitespace = true;
      return between;
    }
    if (code === BACKSLASH) return backslash(code);
    if (code === DOLLAR && isDollarOpener()) return closeDollars(code);
    effects.enter('texMathValue');
    return value(code);
  }

  function value(code: Code): State | undefined {
    if (
      code === null ||
      code === BACKTICK ||
      code === BACKSLASH ||
      isLineEnding(code) ||
      (code === DOLLAR && isDollarOpener())
    ) {
      effects.exit('texMathValue');
      return between(code);
    }
    effects.consume(code);
    afterWhitespace = isWhitespace(code);
    if (!afterWhitespace) hasContent = true;
    return value;
  }

  /**
   * A backslash always pairs with the next character, so `\$` never closes
   * dollar math and `\\)` is a TeX line break followed by `)`, not `\)`.
   */
  function backslash(code: Code): State | undefined {
    pending = effects.enter('texMathDelimiter');
    effects.consume(code);
    afterWhitespace = false;
    return afterBackslash;
  }

  function afterBackslash(code: Code): State | undefined {
    if ((opener === 'paren' && code === RIGHT_PAREN) || (opener === 'bracket' && code === RIGHT_BRACKET)) {
      if (!hasContent) return nok(code);
      effects.consume(code);
      effects.exit('texMathDelimiter');
      effects.exit(outer.type);
      return ok;
    }
    // Not a closing delimiter: the backslash is part of the value.
    pending.type = 'texMathValue';
    hasContent = true;
    if (code === null || code === BACKTICK || isLineEnding(code)) {
      effects.exit('texMathValue');
      return between(code);
    }
    effects.consume(code);
    return value;
  }

  function closeDollars(code: Code): State | undefined {
    if (opener === 'dollar') {
      // Pandoc: the closing `$` must follow a non-space character.
      if (afterWhitespace || !hasContent) return nok(code);
      effects.enter('texMathDelimiter');
      effects.consume(code);
      effects.exit('texMathDelimiter');
      return afterSingleClose;
    }
    pending = effects.enter('texMathDelimiter');
    closeSize = 0;
    return closeRun(code);
  }

  function afterSingleClose(code: Code): State | undefined {
    // Pandoc: ...and must not be followed by a digit, so "$5-$10" stays text.
    if (isAsciiDigit(code)) return nok(code);
    effects.exit(outer.type);
    return ok(code);
  }

  function closeRun(code: Code): State | undefined {
    if (code === DOLLAR) {
      effects.consume(code);
      closeSize += 1;
      return closeRun;
    }
    if (closeSize === 2 && hasContent) {
      effects.exit('texMathDelimiter');
      effects.exit(outer.type);
      return ok(code);
    }
    // A run of the wrong length is part of the value.
    pending.type = 'texMathValue';
    hasContent = true;
    afterWhitespace = false;
    return value(code);
  }
}

// A failed opener simply fails: micromark then emits its characters as `data`,
// which joins the surrounding run of `data` tokens. (Emitting a separate token
// instead would split that run, and micromark merges every run with its own
// array splice, which made price-heavy paragraphs quadratic.)
const dollarTextMath: Construct = { name: 'texMathDollar', tokenize: tokenizeTextMath, previous: previousIsNotDollar };
const backslashTextMath: Construct = { name: 'texMathBackslash', tokenize: tokenizeTextMath };

// ---------------------------------------------------------------------------
// Block math: `$$` or `\[` alone on a line, closed by a line ending in `$$` or `\]`.
// Container handling follows micromark-extension-math's `mathFlow`.
// ---------------------------------------------------------------------------

const nonLazyContinuation: Construct = { tokenize: tokenizeNonLazyContinuation, partial: true };

function tokenizeNonLazyContinuation(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  // A lazy line (one missing its container prefix) ends the block.
  const lineStart: State = (code) => (this.parser.lazy[this.now().line] ? nok(code) : ok(code));

  return function start(code: Code): State | undefined {
    if (code === null) return ok(code);
    effects.enter('lineEnding');
    effects.consume(code);
    effects.exit('lineEnding');
    return lineStart;
  };
}

function tokenizeBlockMath(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  // micromark sets `interrupt` on the per-attempt context before calling tokenize.
  const interrupt = this.interrupt;
  const tail = this.events[this.events.length - 1];
  const initialSize =
    tail && tail[1].type === 'linePrefix' ? tail[2].sliceSerialize(tail[1], true).length : 0;
  const closingDelimiter: Construct = { tokenize: tokenizeClosingDelimiter, partial: true };
  /** Length of the opening `$` run; 0 for a `\[` block. */
  let dollars = 0;

  const isClosingStart = (code: Code) => (dollars ? code === DOLLAR : code === BACKSLASH);

  return start;

  function start(code: Code): State | undefined {
    effects.enter('texMathBlock');
    effects.enter('texMathBlockFence');
    effects.enter('texMathDelimiter');
    if (code === BACKSLASH) {
      effects.consume(code);
      return openBracket;
    }
    return openDollars(code);
  }

  function openDollars(code: Code): State | undefined {
    if (code === DOLLAR) {
      effects.consume(code);
      dollars += 1;
      return openDollars;
    }
    if (dollars < 2) return nok(code);
    effects.exit('texMathDelimiter');
    return spaceRun(effects, openingLineEnd, 'whitespace')(code);
  }

  function openBracket(code: Code): State | undefined {
    if (code !== LEFT_BRACKET) return nok(code);
    effects.consume(code);
    effects.exit('texMathDelimiter');
    return spaceRun(effects, openingLineEnd, 'whitespace');
  }

  /** The opener must be alone on its line; otherwise the paragraph and text math handle it. */
  function openingLineEnd(code: Code): State | undefined {
    if (code !== null && !isLineEnding(code)) return nok(code);
    effects.exit('texMathBlockFence');
    // Only checking whether a block can interrupt a paragraph: the opener is enough.
    if (interrupt) return ok(code);
    return effects.attempt(nonLazyContinuation, contentStart, after)(code);
  }

  function contentStart(code: Code): State | undefined {
    return initialSize
      ? spaceRun(effects, lineStart, 'linePrefix', initialSize + 1)(code)
      : lineStart(code);
  }

  function lineStart(code: Code): State | undefined {
    if (code === null) return after(code);
    if (isLineEnding(code)) return effects.attempt(nonLazyContinuation, contentStart, after)(code);
    return lineContent(code);
  }

  function lineContent(code: Code): State | undefined {
    if (isClosingStart(code)) return effects.attempt(closingDelimiter, after, valueStart)(code);
    return valueStart(code);
  }

  function valueStart(code: Code): State | undefined {
    effects.enter('texMathBlockValue');
    effects.consume(code);
    if (code === BACKSLASH) return escaped;
    // A `$` run that failed as a closer: no suffix of it can close either (it
    // is shorter, or has the same tail), so take the whole run instead of
    // retrying the closer at every dollar.
    return code === DOLLAR ? dollarRun : value;
  }

  function dollarRun(code: Code): State | undefined {
    if (code === DOLLAR) {
      effects.consume(code);
      return dollarRun;
    }
    return value(code);
  }

  function value(code: Code): State | undefined {
    if (code === null || isLineEnding(code)) {
      effects.exit('texMathBlockValue');
      return lineStart(code);
    }
    if (isClosingStart(code)) {
      effects.exit('texMathBlockValue');
      return lineContent(code);
    }
    effects.consume(code);
    return code === BACKSLASH ? escaped : value;
  }

  /** The character after a backslash is always part of the value (`\\]` does not close). */
  function escaped(code: Code): State | undefined {
    if (code === null || isLineEnding(code)) return value(code);
    effects.consume(code);
    return value;
  }

  function after(code: Code): State | undefined {
    effects.exit('texMathBlock');
    return ok(code);
  }

  /** `$$` (at least as many dollars as the opener) or `\]`, then only whitespace to the end of the line. */
  function tokenizeClosingDelimiter(this: TokenizeContext, fx: Effects, done: State, fail: State): State {
    let size = 0;
    return closeStart;

    function closeStart(code: Code): State | undefined {
      fx.enter('texMathBlockFence');
      fx.enter('texMathDelimiter');
      if (dollars) return closeDollars(code);
      fx.consume(code);
      return closeBracket;
    }

    function closeDollars(code: Code): State | undefined {
      if (code === DOLLAR) {
        fx.consume(code);
        size += 1;
        return closeDollars;
      }
      if (size < dollars) return fail(code);
      fx.exit('texMathDelimiter');
      return spaceRun(fx, closeEnd, 'whitespace')(code);
    }

    function closeBracket(code: Code): State | undefined {
      if (code !== RIGHT_BRACKET) return fail(code);
      fx.consume(code);
      fx.exit('texMathDelimiter');
      return spaceRun(fx, closeEnd, 'whitespace');
    }

    function closeEnd(code: Code): State | undefined {
      if (code !== null && !isLineEnding(code)) return fail(code);
      fx.exit('texMathBlockFence');
      return done(code);
    }
  }
}

const blockMath: Construct = { name: 'texMathBlock', tokenize: tokenizeBlockMath, concrete: true };

/** micromark syntax extension. */
const texMathSyntax: MicromarkExtension = {
  flow: { [DOLLAR]: blockMath, [BACKSLASH]: blockMath },
  text: { [DOLLAR]: dollarTextMath, [BACKSLASH]: backslashTextMath },
};

// ---------------------------------------------------------------------------
// mdast builders.
// ---------------------------------------------------------------------------

function mathCode(value: string, display: boolean): Element {
  const text: Text = { type: 'text', value };
  return {
    type: 'element',
    tagName: 'code',
    properties: { className: ['language-math', display ? 'math-display' : 'math-inline'] },
    children: [text],
  };
}

function enterTextMath(this: CompileContext, token: Token): undefined {
  this.enter({ type: 'inlineMath', value: '' }, token);
  this.buffer();
}

function exitTextMath(this: CompileContext, token: Token): undefined {
  const value = this.resume().trim();
  const node = this.stack[this.stack.length - 1];
  this.exit(token);
  if (node.type !== 'inlineMath') return;
  // remark-math's shape: an inline <code> that rehype-katex replaces.
  const code = mathCode(value, token.type === 'texMathDisplay');
  node.value = value;
  node.data = { hName: 'code', hProperties: code.properties, hChildren: code.children };
}

function enterBlockMath(this: CompileContext, token: Token): undefined {
  this.enter({ type: 'math', value: '' }, token);
  this.buffer();
  this.data.texMathBlockFences = 0;
}

function exitBlockFence(this: CompileContext): undefined {
  this.data.texMathBlockFences = (this.data.texMathBlockFences ?? 0) + 1;
}

function exitBlockMath(this: CompileContext, token: Token): undefined {
  const value = this.resume().trim();
  const closed = this.data.texMathBlockFences === 2;
  this.data.texMathBlockFences = undefined;
  const node = this.stack[this.stack.length - 1];
  this.exit(token);
  if (node.type !== 'math') return;

  if (closed) {
    node.value = value;
    node.data = { hName: 'pre', hChildren: [mathCode(value, true)] };
    return;
  }

  // Never closed (usually still streaming): show the source as plain text
  // instead of typesetting a half-written formula.
  const parent = this.stack[this.stack.length - 1] as Parent;
  const paragraph: Paragraph = {
    type: 'paragraph',
    children: [{ type: 'text', value: this.sliceSerialize(token) }],
    position: node.position,
  };
  parent.children[parent.children.length - 1] = paragraph;
}

function exitValue(this: CompileContext, token: Token): undefined {
  this.config.enter.data.call(this, token);
  this.config.exit.data.call(this, token);
}

/** mdast-util-from-markdown extension. */
const texMathFromMarkdown: FromMarkdownExtension = {
  enter: {
    texMathInline: enterTextMath,
    texMathDisplay: enterTextMath,
    texMathBlock: enterBlockMath,
  },
  exit: {
    texMathInline: exitTextMath,
    texMathDisplay: exitTextMath,
    texMathValue: exitValue,
    texMathBlockFence: exitBlockFence,
    texMathBlockValue: exitValue,
    texMathBlock: exitBlockMath,
  },
};

/** remark plugin: parse TeX math delimiters into remark-math compatible nodes. */
export function remarkTexMath(this: Processor): undefined {
  const data = this.data() as {
    micromarkExtensions?: MicromarkExtension[];
    fromMarkdownExtensions?: FromMarkdownExtension[];
  };
  (data.micromarkExtensions ??= []).push(texMathSyntax);
  (data.fromMarkdownExtensions ??= []).push(texMathFromMarkdown);
}
