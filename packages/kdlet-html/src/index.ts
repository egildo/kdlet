/**
 * The HTML renderer: a vocabulary for kdlet and a function that writes the
 * evaluated tree as a string.
 *
 * Attributes follow Pug's runtime rules (`pug_attr`, `pug_classes`, `pug_style`,
 * `pug_escape`). Every text and attribute value is escaped, and there is no way
 * to switch that off.
 */

import { defineVocabulary } from 'kdlet';
import type { Json, OutNode, Problem, Vocabulary } from 'kdlet';

const ELEMENT = /^[A-Za-z][A-Za-z0-9:_-]*$/;
const ATTRIBUTE = /^[^\s"'<>/=]+$/;
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

/** The text node: a node named `-` holds text among child elements. This is this renderer's own convention. */
const TEXT = '-';

/**
 * Any element name is accepted. A dotted name is an element and its classes
 * (`tr.row.wide`). `class` and `style` add; every other field is replaced by a
 * later write.
 */
export const vocabulary: Vocabulary = defineVocabulary({
  elements: '*',
  adds: ['class', 'style'],
  readName(name) {
    if (name === TEXT) return { element: TEXT };
    if (name.startsWith('.')) return { problem: `"${name}" starts with a dot, and there is no implied div; write the element, as in div${name}` };
    const [element, ...classes] = name.split('.');
    if (!ELEMENT.test(element)) return { problem: `"${element}" is not an element name` };
    if (classes.includes('')) return { problem: `"${name}" has an empty class` };
    return { element, fields: classes.map((c): [string, Json] => ['class', c]) };
  },
});

/** Pug's escape: ampersand, angle brackets and double quote. */
export function escape(text: string): string {
  return text.replace(/["&<>]/g, (c) => ({ '"': '&quot;', '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);
}

export class RenderError extends Error {
  constructor(public problems: Problem[]) {
    super(problems.map((p) => `${p.line}:${p.column} ${p.message}`).join('\n'));
    this.name = 'RenderError';
  }
}

export interface RenderOptions {
  /** Write `<!DOCTYPE html>` and a newline first. */
  doctype?: boolean;
}

export function render(tree: readonly OutNode[], options: RenderOptions = {}): string {
  const problems: Problem[] = [];
  const fail = (message: string, at: { line: number; column: number }): void => void problems.push({ message, line: at.line, column: at.column });

  const piece = (v: Json, what: string, at: { line: number; column: number }): string | undefined => {
    if (typeof v === 'string' || typeof v === 'number') return String(v);
    fail(`${what} takes text or a number, not ${JSON.stringify(v)}`, at);
    return undefined;
  };

  const attributes = (n: OutNode): string => {
    let out = '';
    for (const [name, value] of Object.entries(n.fields)) {
      const at = n.fieldLocs[name] ?? n.loc;
      if (!ATTRIBUTE.test(name)) {
        fail(`"${name}" is not an attribute name`, at);
      } else if (name === 'class' || name === 'style') {
        const parts = ([] as Json[]).concat(value).map((v) => piece(v, `"${name}"`, at)).filter((s): s is string => !!s);
        const joined = name === 'class' ? parts.join(' ') : parts.map((s) => (s.endsWith(';') ? s : `${s};`)).join('');
        if (joined) out += ` ${name}="${escape(joined)}"`;
      } else if (value === true) {
        out += ` ${name}`;
      } else if (value !== false && value !== null) {
        const text = piece(value, `"${name}"`, at);
        if (text !== undefined) out += ` ${name}="${escape(text)}"`;
      }
    }
    return out;
  };

  const text = (n: OutNode): string =>
    escape(n.args.map((a, i) => piece(a, 'text', n.argLocs[i] ?? n.loc) ?? '').join(''));

  const node = (n: OutNode): string => {
    if (n.kind === 'call') {
      fail(`"+${n.name}" was not expanded; the HTML renderer needs a definition for it`, n.loc);
      return '';
    }
    if (n.name === TEXT) {
      for (const _ of [...Object.keys(n.fields), ...n.children]) fail('a "-" node holds text only', n.loc);
      return text(n);
    }
    const open = `<${n.name}${attributes(n)}>`;
    if (VOID.has(n.name)) {
      if (n.args.length > 0 || n.children.length > 0) fail(`"${n.name}" is a void element and takes no content`, n.loc);
      return open;
    }
    return `${open}${text(n)}${n.children.map(node).join('')}</${n.name}>`;
  };

  const html = (options.doctype ? '<!DOCTYPE html>\n' : '') + tree.map(node).join('');
  if (problems.length > 0) throw new RenderError(problems);
  return html;
}
