/**
 * KDL text to a source document.
 *
 * The reader is tolerant on purpose: what it cannot accept is reported and left
 * out, and reading carries on, so one run names every problem in the file. It
 * checks everything that follows from the file alone: the shape of each
 * reserved word, which guards are in scope, which names are references. What
 * needs a vocabulary or inputs (is this element known, is this value there) is
 * the evaluator's.
 *
 * KDL does not refuse a property written twice and keeps the rightmost
 * silently, so the reader refuses it.
 */

import { parse, InvalidKdlError } from '@bgotink/kdl';
import type { Entry, Node } from '@bgotink/kdl';
import { NO_LOC, entriesOf, locOf, noBody, noEntries, plainWord, readBody as readGuards, readRef, report } from 'kdlet-guards/kdl';
import type { Document, Item, Loc, Name, Param, Problem, Prop, Value } from './model.js';
import { RESERVED } from './vocabulary.js';

export interface ReadOptions {
  /** Top-level node names that are the host's. Such a node is handed back as a `host` item, unread. */
  words?: readonly string[];
}

/** Where a node's body is read: inside an element (fields and `when` allowed), or in a plain list of nodes. */
type Ctx = 'node' | 'list';

interface Scope {
  /** Guards visible here: written in this body or an enclosing one, up to the nearest definition. */
  guards: ReadonlySet<string>;
  /** Item names of the `each`es around, up to the nearest definition. */
  items: ReadonlySet<string>;
  top: boolean;
  /** Set inside a definition: counts its `block`s. */
  define?: { blocks: number };
}

interface Run {
  sink: Problem[];
  words: ReadonlySet<string>;
  defined: Set<string>;
}

function readValue(run: Run, entry: Entry, scope: Scope): Value {
  const tag = entry.getTag();
  const value = entry.getValue();
  const loc = locOf(entry);
  const out: Value = { tag, value, loc };
  if (tag !== null && (tag === 'input' || scope.items.has(tag))) {
    const made = readRef(tag, value);
    if ('problem' in made) report(run, made.problem, entry);
    else out.ref = made.ref;
  }
  return out;
}

function readProps(run: Run, entries: Entry[], scope: Scope): Prop[] {
  return entries.map((entry) => ({ name: entry.getName() as string, value: readValue(run, entry, scope), loc: locOf(entry) }));
}

/** A plain word, with where it was written. */
function word(run: Run, entry: Entry | undefined, what: string, at: Node): Name | undefined {
  const name = plainWord(run, entry, what, at);
  return name === undefined ? undefined : { name, loc: locOf(entry as Entry) };
}

const unseen = (name: string): string =>
  `no guard named "${name}" is in scope here; a guard is visible from where it is written inward, and a definition sees only its own`;

function guardName(run: Run, entry: Entry, scope: Scope, at: Node): Name {
  const named = word(run, entry, 'a guard name', at);
  if (named && !scope.guards.has(named.name)) {
    report(run, unseen(named.name), entry);
  }
  return named ?? { name: '', loc: locOf(entry) };
}

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------

function readBody(run: Run, nodes: Node[], scope: Scope, ctx: Ctx): Item[] {
  // A guard is visible throughout the body it is written in, before and after its line.
  const declared = new Set<string>();
  for (const node of nodes) {
    if (node.getName() !== 'guard' || node.getTag() !== null) continue;
    const name = node.getArgument(0);
    if (typeof name !== 'string') continue;
    if (declared.has(name)) report(run, `guard "${name}" is written twice in one body`, node);
    else if (scope.guards.has(name)) report(run, `guard "${name}" is already defined in an enclosing scope`, node);
    declared.add(name);
  }
  const here: Scope = { ...scope, guards: new Set([...scope.guards, ...declared]) };
  const inner: Scope = { ...here, top: false };

  const out: Item[] = [];
  let open: 'when' | 'each' | null = null;

  nodes.forEach((node, index) => {
    const before = open;
    open = null;
    const name = node.getName();
    const loc = locOf(node);
    const base = { index, loc };
    const tag = node.getTag();
    if (tag !== null && tag !== 'element') {
      report(run, `unknown tag "(${tag})" on a node; the only tag a node takes is (element)`, node);
      return;
    }
    const forced = tag === 'element';
    const children = (): Node[] => node.children?.nodes ?? [];

    if (forced || !(RESERVED as readonly string[]).includes(name)) {
      if (!forced && name.startsWith('+')) {
        const called = name.slice(1);
        if (called === '') report(run, 'a call needs the name of a definition after "+"', node);
        const { args, props } = entriesOf(run, node, `call "${name}"`);
        for (const arg of args) report(run, 'a call takes its values by name: name=value', arg);
        out.push({ ...base, kind: 'call', name: called, props: readProps(run, props, here), children: readBody(run, children(), inner, 'list') });
      } else if (!forced && scope.top && run.words.has(name)) {
        out.push({ ...base, kind: 'host', name, node });
      } else {
        const { args, props } = entriesOf(run, node, `"${name}"`);
        out.push({
          ...base,
          kind: 'element',
          name,
          forced,
          args: args.map((a) => readValue(run, a, here)),
          props: readProps(run, props, here),
          children: readBody(run, children(), inner, 'node'),
        });
      }
      return;
    }

    switch (name) {
      case 'when':
      case 'else': {
        const { args, props } = entriesOf(run, node, `"${name}"`);
        let follows: 'when' | 'each' = 'when';
        if (name === 'when') {
          if (ctx !== 'node') report(run, `"when" stands directly in an element's body, where it can set the element's fields`, node);
          if (args.length === 0) report(run, '"when" names no guard', node);
          open = 'when';
        } else if (before === null) {
          report(run, '"else" has no "when" or "each" just before it', node);
        } else {
          follows = before;
        }
        const guards = args.map((a) => guardName(run, a, here, node));
        if (name === 'else') {
          if (follows === 'each') {
            if (args.length > 0) report(run, '"else" after an "each" takes no guard; it applies when the list is empty', args[0]);
            if (ctx !== 'node' && props.length > 0) report(run, '"else" has no element here to take fields', props[0]);
          } else {
            open = guards.length > 0 ? 'when' : null;
          }
        }
        const body = { guards, props: readProps(run, props, here), children: readBody(run, children(), inner, ctx) };
        out.push(name === 'when' ? { ...base, kind: 'when', ...body } : { ...base, kind: 'else', follows, ...body });
        return;
      }

      case 'each': {
        const { args, props } = entriesOf(run, node, '"each"');
        if (args.length !== 1) report(run, '"each" takes one item name: each <item> in=<reference> key=<field>', args[1] ?? node);
        const named = args[0] ? word(run, args[0], 'the item name', node) : undefined;
        const itemName = named?.name ?? '';
        if (named && (itemName === 'input' || itemName === 'element')) report(run, `"${itemName}" cannot be an item name`, args[0]);
        else if (named && scope.items.has(itemName)) report(run, `"${itemName}" already names the item of an enclosing "each"`, args[0]);
        let list: Value = { tag: null, value: null, loc };
        let key = '';
        let keyLoc = loc;
        for (const entry of props) {
          const prop = entry.getName();
          if (prop === 'in') {
            list = readValue(run, entry, here);
            if (!list.ref) report(run, '"in" takes a reference to a list, such as in=(input)posts', entry);
          } else if (prop === 'key') {
            const k = word(run, entry, 'the key', node);
            if (k) key = k.name;
            keyLoc = locOf(entry);
          } else {
            report(run, `"each" has no "${prop}"; it takes in= and key=`, entry);
          }
        }
        if (!props.some((p) => p.getName() === 'in')) report(run, '"each" needs in=<reference>', node);
        if (!props.some((p) => p.getName() === 'key')) report(run, '"each" needs key=<field>: the field that identifies an item', node);
        if (children().length === 0) report(run, '"each" needs a body', node);
        const items = new Set([...inner.items, itemName]);
        out.push({ ...base, kind: 'each', item: itemName, list, key, keyLoc, children: readBody(run, children(), { ...inner, items }, 'list') });
        open = 'each';
        return;
      }

      case 'guard': {
        const { args, props } = entriesOf(run, node, '"guard"');
        noEntries(run, props, 'guard');
        if (args.length !== 1) report(run, '"guard" takes one name', args[1] ?? node);
        const named = args[0] ? word(run, args[0], 'the guard name', node) : undefined;
        const guard: Item = { ...base, kind: 'guard', name: named?.name ?? '' };
        if (node.children !== null) {
          if (children().length === 0) report(run, 'a guard with an empty body has nothing to test; write no braces for a guard the host supplies', node);
          // A guard's body is the guards' own to read; the scope, which names and which references count, is ours.
          const body = readGuards(children(), {
            isReference: (tag) => tag === 'input' || here.items.has(tag),
            checkGuard: (name) => (here.guards.has(name) ? undefined : unseen(name)),
            guardNames: 'under-not',
          });
          run.sink.push(...body.problems);
          guard.body = body.conditions;
        }
        out.push(guard);
        return;
      }

      case 'define': {
        if (!scope.top) report(run, '"define" stands at the top of the file', node);
        const { args, props } = entriesOf(run, node, '"define"');
        const named = word(run, args[0], 'the definition name', node);
        if (named) {
          if (run.defined.has(named.name)) report(run, `"${named.name}" is defined twice`, node);
          run.defined.add(named.name);
        }
        const closed: Scope = { guards: new Set(), items: new Set(), top: false, define: { blocks: 0 } };
        const params: Param[] = [];
        const seen = new Set<string>();
        const add = (param: Param, entry: Entry) => {
          if (seen.has(param.name)) report(run, `parameter "${param.name}" is written twice`, entry);
          seen.add(param.name);
          params.push(param);
        };
        for (const entry of args.slice(1)) {
          const p = word(run, entry, 'a parameter name', node);
          if (p) add({ name: p.name, loc: p.loc }, entry);
        }
        for (const entry of props) {
          const value = readValue(run, entry, closed);
          if (value.ref) report(run, 'a default is a plain value; it cannot read an input', entry);
          add({ name: entry.getName() as string, default: value, loc: locOf(entry) }, entry);
        }
        if (children().length === 0) report(run, '"define" needs a body', node);
        const body = readBody(run, children(), closed, 'list');
        out.push({ ...base, kind: 'define', name: named?.name ?? '', params, hasBlock: (closed.define?.blocks ?? 0) > 0, children: body });
        return;
      }

      default: {
        // block
        const { args, props } = entriesOf(run, node, '"block"');
        noEntries(run, [...args, ...props], 'block');
        noBody(run, node, 'block');
        if (!scope.define) report(run, '"block" belongs inside a "define"', node);
        else if (++scope.define.blocks > 1) report(run, 'a definition has one "block"', node);
        out.push({ ...base, kind: 'block' });
      }
    }
  });
  return out;
}

/** Reads a file's text into a source document, with every problem found. */
export function read(text: string, options: ReadOptions = {}): Document {
  const words = new Set(options.words ?? []);
  for (const w of words) {
    if ((RESERVED as readonly string[]).includes(w) || w.startsWith('+')) throw new Error(`read: "${w}" cannot be a host word; it is a word of the language`);
  }
  const sink: Problem[] = [];
  let parsed;
  try {
    parsed = parse(text, { storeLocations: true });
  } catch (error) {
    if (!(error instanceof InvalidKdlError)) throw error;
    const start = (error as InvalidKdlError & { token?: { start: Loc } }).token?.start ?? NO_LOC;
    sink.push({ message: `not valid KDL: ${error.message}`, line: start.line, column: start.column });
    return { nodes: [], problems: sink };
  }
  const run: Run = { sink, words, defined: new Set() };
  const nodes = readBody(run, parsed.nodes, { guards: new Set(), items: new Set(), top: true }, 'list');
  return { nodes, problems: sink };
}
