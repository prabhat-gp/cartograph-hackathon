// Masking: comments and string contents become spaces (newlines kept), so the
// parsers can scan code with plain patterns and never trip on a brace inside a
// string or a keyword inside a comment. Literal values are kept on the side.

export interface Literal {
  /** Offset of the opening quote. */
  start: number;
  end: number;
  value: string;
}

export interface Masked {
  code: string;
  literals: Literal[];
  lineAt(offset: number): number;
  /** The literal whose opening quote is the first non-space at or after `offset`. */
  literalAt(offset: number): Literal | undefined;
}

function lineIndex(text: string): (offset: number) => number {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return (offset: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

function finish(source: string, out: string[], literals: Literal[]): Masked {
  const code = out.join("");
  const lineAt = lineIndex(source);
  const byStart = new Map(literals.map((l) => [l.start, l]));
  return {
    code,
    literals,
    lineAt,
    literalAt(offset: number) {
      let i = offset;
      while (i < code.length && /\s/.test(code[i])) i++;
      return byStart.get(i);
    },
  };
}

const blank = (s: string) => s.replace(/[^\n]/g, " ");

/** Java, Kotlin-ish and Groovy-ish sources: // and block comments, "…", """…""" and '…'. */
export function maskJava(source: string): Masked {
  const out: string[] = [];
  const literals: Literal[] = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      const stop = end < 0 ? n : end;
      out.push(blank(source.slice(i, stop)));
      i = stop;
    } else if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end < 0 ? n : end + 2;
      out.push(blank(source.slice(i, stop)));
      i = stop;
    } else if (c === '"' && source.startsWith('"""', i)) {
      const end = source.indexOf('"""', i + 3);
      const stop = end < 0 ? n : end + 3;
      literals.push({ start: i, end: stop, value: source.slice(i + 3, Math.max(i + 3, stop - 3)) });
      out.push('"' + blank(source.slice(i + 1, stop - 1)) + '"');
      i = stop;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      let value = "";
      while (j < n && source[j] !== c && source[j] !== "\n") {
        if (source[j] === "\\" && j + 1 < n) {
          value += source[j + 1];
          j += 2;
        } else value += source[j++];
      }
      const stop = Math.min(j + 1, n);
      if (c === '"') literals.push({ start: i, end: stop, value });
      out.push(c + blank(source.slice(i + 1, stop - 1)) + (source[j] === c ? c : ""));
      i = stop;
    } else {
      out.push(c);
      i++;
    }
  }
  return finish(source, out, literals);
}

const REGEX_BEFORE = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "~", "^"]);
const QUOTE_BEFORE = new Set([...REGEX_BEFORE, "<", ""]);
const WORD_BEFORE = /(?:^|[^\w$])(return|case|typeof|in|of|default|throw|export|import|from|await|yield|void|delete|new)$/;

/**
 * JavaScript and TypeScript, JSX included. A quote only opens a string where an
 * expression can start and when it closes on the same line, so an apostrophe
 * in JSX text ("Don't") doesn't swallow the rest of the file.
 */
export function maskTs(source: string): Masked {
  const out: string[] = [];
  const literals: Literal[] = [];
  let i = 0;
  const n = source.length;
  let prev = ""; // last significant character
  let prevTail = ""; // a few significant characters, for keywords and =>
  const sig = (s: string) => {
    for (const ch of s) {
      if (!/\s/.test(ch)) {
        prev = ch;
        prevTail = (prevTail + ch).slice(-12);
      } else if (ch === "\n" || ch === " ") prevTail = (prevTail + " ").slice(-12);
    }
  };
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      const stop = end < 0 ? n : end;
      out.push(blank(source.slice(i, stop)));
      i = stop;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end < 0 ? n : end + 2;
      out.push(blank(source.slice(i, stop)));
      i = stop;
      continue;
    }
    const exprStart = QUOTE_BEFORE.has(prev) || prevTail.endsWith("=>") || WORD_BEFORE.test(prevTail.trimEnd());
    if (c === "`") {
      // Template literal: find the closing backtick, skipping ${ … } with nesting.
      let j = i + 1;
      let depth = 0;
      while (j < n) {
        if (depth === 0 && source[j] === "\\") j += 2;
        else if (depth === 0 && source[j] === "`") break;
        else if (source[j] === "$" && source[j + 1] === "{") {
          depth++;
          j += 2;
        } else if (depth > 0 && source[j] === "{") {
          depth++;
          j++;
        } else if (depth > 0 && source[j] === "}") {
          depth--;
          j++;
        } else j++;
      }
      const stop = Math.min(j + 1, n);
      literals.push({ start: i, end: stop, value: source.slice(i + 1, stop - 1) });
      out.push("`" + blank(source.slice(i + 1, stop - 1)) + (source[j] === "`" ? "`" : ""));
      sig("`");
      i = stop;
      continue;
    }
    if ((c === '"' || c === "'") && exprStart) {
      let j = i + 1;
      let value = "";
      while (j < n && source[j] !== c && source[j] !== "\n") {
        if (source[j] === "\\" && j + 1 < n) {
          value += source[j + 1];
          j += 2;
        } else value += source[j++];
      }
      if (source[j] === c) {
        literals.push({ start: i, end: j + 1, value });
        out.push(c + blank(source.slice(i + 1, j)) + c);
        sig(c);
        i = j + 1;
        continue;
      }
    }
    if (c === "/" && (REGEX_BEFORE.has(prev) || prev === "" || WORD_BEFORE.test(prevTail.trimEnd()))) {
      // Regex literal on one line: mask it so its braces and quotes don't count.
      let j = i + 1;
      let inClass = false;
      while (j < n && source[j] !== "\n") {
        if (source[j] === "\\") j += 2;
        else if (source[j] === "[") (inClass = true), j++;
        else if (source[j] === "]") (inClass = false), j++;
        else if (source[j] === "/" && !inClass) break;
        else j++;
      }
      if (source[j] === "/") {
        out.push("/" + blank(source.slice(i + 1, j)) + "/");
        sig("/x/");
        i = j + 1;
        continue;
      }
    }
    out.push(c);
    sig(c);
    i++;
  }
  return finish(source, out, literals);
}

/** Index of the bracket that closes the one at `open` (code must be masked). */
export function matchBracket(code: string, open: number): number {
  const o = code[open];
  const c = o === "{" ? "}" : o === "(" ? ")" : o === "[" ? "]" : o === "<" ? ">" : "";
  if (!c) return -1;
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === o) depth++;
    else if (code[i] === c && --depth === 0) return i;
  }
  return -1;
}

/** "applyVoucher" → "Apply voucher", "CartPageController" → "Cart page controller". */
export function humanize(name: string): string {
  const words = name
    .replace(/[_\-.]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => (i === 0 ? w : /^[A-Z0-9]+$/.test(w) ? w : w.toLowerCase()));
  if (words.length === 0) return name;
  return words[0][0].toUpperCase() + words[0].slice(1) + (words.length > 1 ? " " + words.slice(1).join(" ") : "");
}
