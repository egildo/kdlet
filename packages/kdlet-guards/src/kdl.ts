/**
 * A condition in KDL: reading a guard's body into the model, and writing a
 * condition back as KDL text.
 *
 *     is (input)kind featured
 *     has (post)summary
 *     not featured
 *     all { has (post)kind; is (post)kind featured }
 *
 * The reader is tolerant on purpose: what it cannot accept is reported with
 * its line and column and left out, and reading carries on, so one run names
 * every problem. It checks what follows from the text alone. Whether a guard
 * or a word exists is the host's, and `problems` asks it.
 */

import { Node, format, getLocation } from '@bgotink/kdl';
import type { Entry } from '@bgotink/kdl';
import type { Condition, Json, Loc, Operand, Primitive, Problem, Ref } from './model.js';

export interface ReadOptions {
  /** The words the host registered: a node with one of these names is read as that word. */
  words?: readonly string[];
  /** Whether a tag on a value makes a reference. Default: every tag does. A tag that does not is refused. */
  isReference?: (tag: string) => boolean;
  /** A message when a guard name is not visible where it is written, or nothing. Default: every name is. */
  checkGuard?: (name: string) => string | undefined;
  /**
   * Where a named guard may be written. `anywhere` (default): `not name` and a node `guard name`.
   * `under-not`: only after `not`, which then takes a name and no body.
   */
  guardNames?: 'anywhere' | 'under-not';
}

/** Anything that collects problems: the reader's own run, or a host's. */
export type Sink = { sink: Problem[] };

type Run = Sink & { options: ReadOptions; words: ReadonlySet<string> };

export const NO_LOC: Loc = { line: 1, column: 1 };

/** Where a node or an entry starts. */
export function locOf(element: Node | Entry): Loc {
  const stored = getLocation(element);
  return stored ? { line: stored.start.line, column: stored.start.column } : NO_LOC;
}

/** Records a problem at a node or an entry. */
export function report(run: Sink, message: string, at: Node | Entry): void {
  const loc = locOf(at);
  run.sink.push({ message, line: loc.line, column: loc.column });
}

/** A value as it was written, for a message. */
export const show = (tag: string | null, value: Primitive): string =>
  `${tag ? `(${tag})` : ''}${typeof value === 'string' ? JSON.stringify(value) : value === null ? '#null' : String(value)}`;

/** The arguments and the properties of a node, with a property written twice reported and dropped. */
export function entriesOf(run: Sink, node: Node, what: string): { args: Entry[]; props: Entry[] } {
  const args: Entry[] = [];
  const props: Entry[] = [];
  const seen = new Set<string>();
  for (const entry of node.entries) {
    const key = entry.getName();
    if (key === null) args.push(entry);
    else if (seen.has(key)) report(run, `"${key}" is written twice on ${what}; KDL would keep only the last`, entry);
    else {
      seen.add(key);
      props.push(entry);
    }
  }
  return { args, props };
}

export function noBody(run: Sink, node: Node, what: string): void {
  for (const child of node.children?.nodes ?? []) report(run, `${what} takes no body`, child);
}

export function noEntries(run: Sink, entries: Entry[], what: string): void {
  for (const entry of entries) report(run, `${what} takes no ${entry.getName() === null ? 'arguments' : 'properties'}`, entry);
}

/** What a tag and a value make as a reference: the reference, or the problem with it. A reference names one field, as text. */
export function readRef(tag: string, value: Primitive): { ref: Ref } | { problem: string } {
  if (typeof value !== 'string' || value === '') return { problem: `${show(tag, value)}: a reference names a field with text` };
  if (value.includes('.')) return { problem: `${show(tag, value)}: a reference names a single field; paths are not part of the language` };
  return { ref: { from: tag, field: value } };
}

/** A reference, or with `first` unset a plain value as well. */
function operand(run: Run, entry: Entry, kind: string, first: boolean): Operand | undefined {
  const tag = entry.getTag();
  const value = entry.getValue();
  const starts = () => report(run, `"${kind}" starts with a reference such as (input)name or (item)field, not ${show(tag, value)}`, entry);
  if (tag === null) {
    if (!first) return value;
    starts();
    return undefined;
  }
  if (!(run.options.isReference?.(tag) ?? true)) {
    if (first) starts();
    else report(run, `"${kind}" compares plain values and references, not (${tag}) values`, entry);
    return undefined;
  }
  const made = readRef(tag, value);
  if ('problem' in made) {
    report(run, made.problem, entry);
    return undefined;
  }
  return { ref: made.ref, loc: locOf(entry) };
}

/** A plain word: untagged text. */
export function plainWord(run: Sink, entry: Entry | undefined, what: string, at: Node): string | undefined {
  if (!entry) {
    report(run, `${what} is missing`, at);
    return undefined;
  }
  const value = entry.getValue();
  if (entry.getTag() !== null || typeof value !== 'string' || value === '') {
    report(run, `${what} must be a plain word, not ${show(entry.getTag(), value)}`, entry);
    return undefined;
  }
  return value;
}

function guardRef(run: Run, entry: Entry, at: Node): Extract<Condition, { guard: string }> | undefined {
  const name = plainWord(run, entry, 'a guard name', at);
  if (name === undefined) return undefined;
  const problem = run.options.checkGuard?.(name);
  if (problem) report(run, problem, entry);
  return { guard: name, loc: locOf(entry) };
}

const list = (names: string[]): string => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

function readNode(run: Run, node: Node): Condition | undefined {
  const kind = node.getName();
  const loc = locOf(node);
  const { args, props } = entriesOf(run, node, kind);
  if (node.getTag() !== null) report(run, `"${kind}" takes no tag`, node);
  const nodes = node.children?.nodes ?? [];
  const named = run.options.guardNames !== 'under-not';

  switch (kind) {
    case 'is':
    case 'has': {
      noEntries(run, props, kind);
      noBody(run, node, kind);
      if (args.length === 0 || (kind === 'is' && args.length < 2) || (kind === 'has' && args.length > 1)) {
        report(run, kind === 'is' ? '"is" takes a reference and at least one value' : '"has" takes one reference', node);
        return undefined;
      }
      const first = operand(run, args[0], kind, true);
      if (kind === 'has') return first === undefined ? undefined : { has: first, loc };
      const values = args.slice(1).map((a) => operand(run, a, kind, false));
      // A value left out would make the `is` narrower than it was written: unreadable as a whole.
      return first === undefined || values.includes(undefined) ? undefined : { is: first, values: values as Operand[], loc };
    }
    case 'not': {
      noEntries(run, props, kind);
      if (!named || args.length > 0) {
        noBody(run, node, kind);
        if (args.length !== 1) {
          report(run, named ? '"not" takes the name of one guard, or a body' : '"not" takes the name of one guard', node);
          return undefined;
        }
        const target = guardRef(run, args[0], node);
        return target && { not: target, loc };
      }
      if (nodes.length === 0) {
        report(run, '"not" takes the name of one guard, or a body', node);
        return undefined;
      }
      const inner = readAll(run, nodes);
      return inner && { not: allOf(inner), loc };
    }
    case 'all':
    case 'any': {
      noEntries(run, [...args, ...props], kind);
      if (nodes.length === 0) {
        report(run, `"${kind}" needs a body`, node);
        return undefined;
      }
      const body = readAll(run, nodes);
      if (!body) return undefined;
      return kind === 'all' ? { all: body, loc } : { any: body, loc };
    }
    case 'guard':
      if (named) {
        noEntries(run, props, kind);
        noBody(run, node, kind);
        if (args.length !== 1) {
          report(run, '"guard" takes the name of one guard', node);
          return undefined;
        }
        const target = guardRef(run, args[0], node);
        return target && { guard: target.guard, loc };
      }
    // falls through: under `under-not`, `guard` is no word of a guard's body
    default: {
      if (!run.words.has(kind)) {
        report(run, `a guard's body takes ${list(['is', 'has', 'not', 'all', 'any', ...(named ? ['guard'] : []), ...run.words])}, not "${kind}"`, node);
        return undefined;
      }
      if (args.length > 0 && props.length > 0) report(run, `"${kind}" takes arguments or properties, not both`, node);
      const plain = [...args, ...props].filter((e) => e.getTag() !== null);
      for (const entry of plain) report(run, `"${kind}" takes plain values; the tag on ${show(entry.getTag(), entry.getValue())} means nothing here`, entry);
      const word: Extract<Condition, { word: string }> = { word: kind, loc };
      if (props.length > 0) word.args = Object.fromEntries(props.map((e) => [e.getName() as string, e.getValue()]));
      else if (args.length > 0) word.args = args.map((e) => e.getValue());
      if (nodes.length > 0) {
        const inner = readAll(run, nodes);
        if (!inner) return undefined;
        word.body = inner;
      }
      return word;
    }
  }
}

function readNodes(run: Run, nodes: Node[]): Condition[] {
  return nodes.map((n) => readNode(run, n)).filter((c): c is Condition => c !== undefined);
}

/** The conditions of a nested body, or `undefined` when one could not be read: a condition with a part missing would say something else. */
function readAll(run: Run, nodes: Node[]): Condition[] | undefined {
  const body = readNodes(run, nodes);
  return body.length === nodes.length ? body : undefined;
}

/** Several conditions in a row are all of them. */
const allOf = (body: Condition[]): Condition => (body.length === 1 ? body[0] : { all: body });

/** Reads one node as a condition. `undefined` when it could not be read; the problems say why. */
export function readGuard(node: Node, options: ReadOptions = {}): { condition?: Condition; problems: Problem[] } {
  const sink: Problem[] = [];
  const condition = readNode({ sink, options, words: new Set(options.words) }, node);
  return { condition, problems: sink };
}

/** Reads the nodes of a guard's body, in order. A node that could not be read is left out of the list, so a caller checks `problems` before it trusts the list. */
export function readBody(nodes: Node[], options: ReadOptions = {}): { conditions: Condition[]; problems: Problem[] } {
  const sink: Problem[] = [];
  const conditions = readNodes({ sink, options, words: new Set(options.words) }, nodes);
  return { conditions, problems: sink };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

function primitive(value: Json, what: string): Primitive {
  if (value !== null && typeof value === 'object') throw new RangeError(`${what}: KDL holds plain values in a node's arguments, not ${Array.isArray(value) ? 'a list' : 'an object'}`);
  return value;
}

function withOperand(node: Node, op: Operand): Node {
  if (typeof op === 'object' && op !== null) node.addArgument(op.ref.field, op.ref.from);
  else node.addArgument(op);
  return node;
}

function toNode(c: Condition): Node {
  if ('is' in c) {
    const node = withOperand(Node.create('is'), c.is);
    c.values.forEach((v) => withOperand(node, v));
    return node;
  }
  if ('has' in c) return withOperand(Node.create('has'), c.has);
  if ('not' in c) {
    const node = Node.create('not');
    if ('guard' in c.not) node.addArgument(c.not.guard);
    else node.appendNode(toNode(c.not));
    return node;
  }
  if ('all' in c || 'any' in c) {
    const node = Node.create('all' in c ? 'all' : 'any');
    for (const x of 'all' in c ? c.all : c.any) node.appendNode(toNode(x));
    return node;
  }
  if ('guard' in c) {
    const node = Node.create('guard');
    node.addArgument(c.guard);
    return node;
  }
  const node = Node.create(c.word);
  const args = c.args ?? null;
  if (Array.isArray(args)) args.forEach((a, i) => node.addArgument(primitive(a, `"${c.word}" argument ${i + 1}`)));
  else if (args !== null && typeof args === 'object') for (const [k, v] of Object.entries(args)) node.setProperty(k, primitive(v, `"${c.word}" property "${k}"`));
  else if (args !== null) throw new RangeError(`"${c.word}": the arguments of a word are a list or an object to be written as KDL`);
  for (const x of c.body ?? []) node.appendNode(toNode(x));
  return node;
}

/**
 * A condition as KDL text, one node with its children indented by four spaces. A `not` of a named guard is
 * `not name`; a `not` of anything else holds it in a body. A plain value where a reference is expected is
 * written as it is, to be shown; the reader asks for a reference there. Throws a `RangeError` for a word's arguments that
 * KDL cannot hold as they are: a bare value, or a list or an object inside the arguments.
 */
export function writeGuard(condition: Condition): string {
  return format(toNode(condition)).replace(/\t/g, '    ').trimEnd();
}
