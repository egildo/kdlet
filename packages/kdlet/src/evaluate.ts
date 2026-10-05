/**
 * A source document, with inputs and a vocabulary, to a plain tree.
 *
 * One call evaluates one document once; the document is never changed, so a
 * consumer evaluates it again for each combination of inputs it needs. Every
 * problem is collected with its position and the run carries on, so one run
 * reports them all. A document that did not read cleanly is not evaluated.
 */

import { check } from 'kdlet-guards';
import type { Condition, GuardFn as GuardCode, Host } from 'kdlet-guards';
import type {
  Document,
  GuardFn,
  Item,
  Json,
  Key,
  Loc,
  Name,
  OutNode,
  Problem,
  Ref,
  Structure,
  Value,
  Vocabulary,
} from './model.js';
import { defineVocabulary } from './vocabulary.js';

export interface EvaluateOptions {
  vocabulary: Vocabulary;
  /** The named values the file reads with `(input)name`. */
  inputs?: Record<string, unknown>;
  /** The host's guards, by name, for the guards the file declares without a body. */
  guards?: Record<string, GuardFn>;
  /** Documents whose `define`s the host supplies. A call to one of them is expanded. */
  definitions?: readonly Document[];
}

export interface Evaluation {
  tree: OutNode[];
  problems: Problem[];
}

type Rec = Record<string, unknown>;
type Define = Extract<Item, { kind: 'define' }>;
type GuardItem = Extract<Item, { kind: 'guard' }>;

/** Where a body stands in the template: the pieces of a place, and the keys around. */
interface Place {
  /** The call sites an expansion came through: `3>` for what the call at `3` expanded to. */
  origin: string;
  path: number[];
  keys: Key[];
}

interface Scope {
  /** The inputs, or inside a definition its parameters. A missing value is simply not there. */
  vars: Rec;
  items: Map<string, Rec>;
  /** The guards visible here, as kdlet-guards sees them: a condition, or for the host's a function of the scope it was written in. */
  guards: Record<string, Condition | GuardCode>;
  /** Inside an expanded definition: what its `block` stands for. */
  block?: { children: Item[]; scope: Scope; at: Place };
  /** The definitions being expanded, outermost first, to refuse a call that never ends. */
  stack: string[];
}

/** Where a body's nodes go. `node` is set when the body is an element's, so fields and `when` have something to write to. */
interface Target {
  out: OutNode[];
  node?: Builder;
}

/** An element being built: its arguments and its fields, written in order. */
class Builder {
  args: Json[] = [];
  argLocs: Loc[] = [];
  fields = new Map<string, Json>();
  fieldLocs = new Map<string, Loc>();
  constructor(private adds: ReadonlySet<string>) {}

  write(name: string, value: Json, loc: Loc): void {
    const list = this.adds.has(name) ? [...((this.fields.get(name) as Json[] | undefined) ?? []), value] : undefined;
    this.fields.set(name, list ?? value);
    this.fieldLocs.set(name, loc);
  }

  /** A structure replaces the field, or is added to it as one item when the field adds. */
  writeStructure(name: string, structure: Structure, loc: Loc): void {
    const before = this.adds.has(name) ? ((this.fields.get(name) as Json[] | undefined) ?? []) : [];
    this.fields.set(name, this.adds.has(name) ? [...before, structure] : structure);
    this.fieldLocs.set(name, loc);
  }

  writeList(name: string, values: Json[], loc: Loc): void {
    const before = this.adds.has(name) ? ((this.fields.get(name) as Json[] | undefined) ?? []) : [];
    this.fields.set(name, [...before, ...values]);
    this.fieldLocs.set(name, loc);
  }
}

const present = (record: Rec, name: string): boolean => Object.hasOwn(record, name) && record[name] !== undefined;
const describe = (ref: Ref): string => `(${ref.from})${ref.field}`;
const isRecord = (x: unknown): x is Rec => x !== null && typeof x === 'object' && !Array.isArray(x);

export function evaluate(document: Document, options: EvaluateOptions): Evaluation {
  const vocab = defineVocabulary(options.vocabulary);
  const supplied = options.definitions ?? [];
  const unread = [document, ...supplied].flatMap((d) => d.problems);
  if (unread.length > 0) return { tree: [], problems: unread };

  const childFields = new Set(vocab.childFields);
  const adds = new Set(vocab.adds);
  const tags = new Set(vocab.tags);
  const problems: Problem[] = [];
  const err = (message: string, at: Loc): void => void problems.push({ message, line: at.line, column: at.column });

  // ---- definitions: the host's, then the file's ---------------------------
  const defs = new Map<string, Define>();
  for (const [doc, fromHost] of [...supplied.map((d) => [d, true] as const), [document, false] as const]) {
    for (const item of doc.nodes) {
      if (item.kind !== 'define') continue;
      if (defs.has(item.name)) err(fromHost || supplied.length === 0 ? `"${item.name}" is supplied twice` : `"${item.name}" is defined in the file and also supplied by the host`, item.loc);
      else defs.set(item.name, item);
    }
  }

  // ---- values --------------------------------------------------------------
  const lookup = (ref: Ref, scope: Scope): unknown => {
    const record = ref.from === 'input' ? scope.vars : scope.items.get(ref.from);
    return record && present(record, ref.field) ? record[ref.field] : undefined;
  };

  /** A value ready to put in the output, or undefined. With `show`, a missing reference is an error. */
  const value = (v: Value, scope: Scope, show: boolean): Json | undefined => {
    if (v.ref) {
      const found = lookup(v.ref, scope);
      if (found === undefined && show) err(`${describe(v.ref)} has no value here, so there is nothing to show`, v.loc);
      return found as Json | undefined;
    }
    if (v.tag === null) return v.value;
    if (tags.has(v.tag)) return { tag: v.tag, value: v.value };
    err(`unknown tag "(${v.tag})": it is not an input, not the item of an enclosing "each", and not a tag the renderer accepts`, v.loc);
    return undefined;
  };

  // ---- guards ----------------------------------------------------------------
  // What a guard is, and how it is answered, is kdlet-guards'. The scope is ours: which guards are visible where,
  // what a reference reads, and what the host's functions see.

  /** The scope's own view of itself for the guards: its references read here, its guards are the ones visible here. */
  const hosts = new WeakMap<Scope, Host>();
  const hostOf = (scope: Scope): Host => {
    let host = hosts.get(scope);
    if (!host) hosts.set(scope, (host = { resolve: (ref) => lookup(ref, scope), guards: scope.guards, missing: 'error' }));
    return host;
  };

  /** A guard the host supplies, which sees the inputs and the items in scope where the guard was written. */
  const hostGuard = (name: string, scope: Scope): GuardCode => () => {
    const fn = options.guards && Object.hasOwn(options.guards, name) ? options.guards[name] : undefined;
    if (!fn) return { error: `guard "${name}" is the host's and the host supplied none` };
    return fn({ inputs: { ...scope.vars }, items: Object.fromEntries(scope.items) });
  };

  /** A guard's body is true when all of it is. */
  const bodyOf = (body: Condition[]): Condition => (body.length === 1 ? body[0] : { all: body });

  const holds = (name: Name, scope: Scope): boolean => {
    const answer = check({ guard: name.name, loc: name.loc }, hostOf(scope));
    for (const e of answer.errors) err(e.message, e.loc ?? name.loc);
    return answer.holds;
  };

  // ---- the walk -------------------------------------------------------------------
  const writeProps = (b: Builder, props: { name: string; value: Value; loc: Loc }[], scope: Scope): void => {
    for (const p of props) {
      const v = value(p.value, scope, true);
      if (v !== undefined) b.write(p.name, v, p.loc);
    }
  };

  const identity = (at: Place, path: number[], address?: string) => ({
    place: at.origin + path.join('/'),
    keys: [...at.keys],
    ...(address !== undefined ? { address } : {}),
  });

  function walk(items: Item[], scope: Scope, at: Place, target: Target): void {
    // A guard is visible throughout the body it is written in, and reads that body's scope.
    let here = scope;
    const declared = items.filter((i): i is Item & GuardItem => i.kind === 'guard');
    if (declared.length > 0) {
      here = { ...scope };
      // fromEntries, so that a guard named `__proto__` is a guard like any other
      here.guards = Object.fromEntries([
        ...Object.entries(scope.guards),
        ...declared.map((def) => [def.name, def.body === undefined ? hostGuard(def.name, here) : bodyOf(def.body)] as const),
      ]);
    }

    // After a `when` or an `each`: did something apply already? Null after anything else.
    let done: boolean | null = null;
    for (const item of items) {
      const was: boolean | null = done;
      done = null;
      const path = [...at.path, item.index];
      const inside: Place = { ...at, path };
      switch (item.kind) {
        case 'guard':
        case 'define':
        case 'host':
          break;
        case 'element':
          element(item, here, at, path, target);
          break;
        case 'when':
          done = item.guards.every((g) => holds(g, here));
          if (done) branch(item, here, inside, target);
          break;
        case 'else':
          if (was === null || was) {
            done = was;
          } else {
            done = item.guards.every((g) => holds(g, here));
            if (done) branch(item, here, inside, target);
          }
          break;
        case 'each':
          done = each(item, here, inside, target);
          break;
        case 'call':
          call(item, here, at, path, target);
          break;
        case 'block':
          if (scope.block) {
            const b = scope.block;
            walk(b.children, b.scope, { ...b.at, keys: at.keys }, { out: target.out });
          }
          break;
      }
    }
  }

  /** What a `when` or an `else` that holds carries: fields on its line, then its body. */
  function branch(item: Extract<Item, { kind: 'when' | 'else' }>, scope: Scope, inside: Place, target: Target): void {
    if (target.node) writeProps(target.node, item.props, scope);
    walk(item.children, scope, inside, target);
  }

  /** A node of a structure: its name, arguments, properties and nested nodes, which are plain nodes and nothing else. */
  function structured(item: Extract<Item, { kind: 'element' }>, scope: Scope): Structure | undefined {
    const out: Structure = { name: item.name, args: [], props: {}, children: [], loc: item.loc, argLocs: [], propLocs: {} };
    const before = problems.length;
    for (const arg of item.args) {
      const v = value(arg, scope, true);
      if (v !== undefined) {
        out.args.push(v);
        out.argLocs.push(arg.loc);
      }
    }
    for (const p of item.props) {
      const v = value(p.value, scope, true);
      if (v !== undefined) {
        out.props[p.name] = v;
        out.propLocs[p.name] = p.loc;
      }
    }
    for (const child of item.children) {
      if (child.kind !== 'element') {
        err(`a field written with a body holds plain nodes; "${child.kind}" has no place in it`, child.loc);
        continue;
      }
      const nested = structured(child, scope);
      if (nested) out.children.push(nested);
    }
    return problems.length > before ? undefined : out;
  }

  function element(item: Extract<Item, { kind: 'element' }>, scope: Scope, at: Place, path: number[], target: Target): void {
    if (!item.forced && childFields.has(item.name)) {
      if (!target.node) {
        err(`"${item.name}" is a field of its element and stands directly in one; write (element)${item.name} for an element of that name`, item.loc);
        return;
      }
      if (item.props.length > 0 || item.children.length > 0) {
        const structure = structured(item, scope);
        if (structure) target.node.writeStructure(item.name, structure, item.loc);
        return;
      }
      const values = item.args.map((a) => value(a, scope, true)).filter((v): v is Json => v !== undefined);
      target.node.writeList(item.name, values, item.loc);
      return;
    }

    const named = vocab.readName ? vocab.readName(item.name) : { element: item.name };
    if ('problem' in named) return err(named.problem, item.loc);
    if (vocab.elements !== '*' && !vocab.elements.includes(named.element)) return err(`"${named.element}" is not an element of this vocabulary`, item.loc);

    const b = new Builder(adds);
    for (const [field, v] of named.fields ?? []) b.write(field, v, item.loc);
    for (const arg of item.args) {
      const v = value(arg, scope, true);
      if (v !== undefined) {
        b.args.push(v);
        b.argLocs.push(arg.loc);
      }
    }
    writeProps(b, item.props, scope);
    const children: OutNode[] = [];
    walk(item.children, scope, { ...at, path }, { out: children, node: b });

    const fields = Object.fromEntries(b.fields);
    target.out.push({
      kind: 'element',
      name: named.element,
      identity: identity(at, path, vocab.address?.({ element: named.element, args: b.args, fields })),
      args: b.args,
      fields,
      children,
      loc: item.loc,
      argLocs: b.argLocs,
      fieldLocs: Object.fromEntries(b.fieldLocs),
    });
  }

  /** Runs the body once per item. Returns whether the list had any, for an `else` that follows. */
  function each(item: Extract<Item, { kind: 'each' }>, scope: Scope, inside: Place, target: Target): boolean {
    const ref = item.list.ref as Ref;
    if (tags.has(item.item)) {
      err(`"${item.item}" is a tag of the renderer and cannot be an item name`, item.loc);
      return true;
    }
    const list = lookup(ref, scope);
    if (!Array.isArray(list)) {
      err(list === undefined ? `${describe(ref)} has no value here, so there is no list to repeat over` : `${describe(ref)} is not a list`, item.list.loc);
      return true;
    }
    const seen = new Set<string>();
    for (const record of list) {
      if (!isRecord(record)) {
        err(`a list holds records, and an item of ${describe(ref)} is not one`, item.list.loc);
        continue;
      }
      const key = record[item.key];
      if (!present(record, item.key) || (typeof key !== 'string' && typeof key !== 'number')) {
        err(`an item of ${describe(ref)} has no text or number in "${item.key}" to be its key`, item.keyLoc);
        continue;
      }
      if (seen.has(String(key))) {
        err(`two items of ${describe(ref)} have the key ${JSON.stringify(key)}`, item.keyLoc);
        continue;
      }
      seen.add(String(key));
      const items = new Map(scope.items).set(item.item, record);
      walk(item.children, { ...scope, items }, { ...inside, keys: [...inside.keys, key] }, { out: target.out });
    }
    return list.length > 0;
  }

  function call(item: Extract<Item, { kind: 'call' }>, scope: Scope, at: Place, path: number[], target: Target): void {
    const def = defs.get(item.name);
    if (!def) {
      // No definition was supplied: the call travels on, for a renderer that has its own.
      const fields = new Map<string, Json>();
      const fieldLocs: Record<string, Loc> = {};
      for (const p of item.props) {
        const v = value(p.value, scope, false);
        if (v !== undefined) {
          fields.set(p.name, v);
          fieldLocs[p.name] = p.loc;
        }
      }
      const children: OutNode[] = [];
      walk(item.children, scope, { ...at, path }, { out: children });
      target.out.push({
        kind: 'call',
        name: item.name,
        identity: identity(at, path),
        args: [],
        fields: Object.fromEntries(fields),
        children,
        loc: item.loc,
        argLocs: [],
        fieldLocs,
      });
      return;
    }

    if (scope.stack.includes(def.name)) return err(`"${def.name}" calls itself`, item.loc);
    const before = problems.length;
    const known = def.params.map((p) => p.name);
    for (const p of item.props) {
      if (!known.includes(p.name)) err(`"${p.name}" is not a parameter of "${def.name}"${known.length ? `; it takes ${known.join(', ')}` : ''}`, p.loc);
    }
    const vars: Rec = Object.create(null);
    for (const param of def.params) {
      const given = item.props.find((p) => p.name === param.name);
      const source = given?.value ?? param.default;
      if (!source) err(`"${def.name}" needs "${param.name}"`, item.loc);
      else {
        // Handing a reference on is not reading it: a missing one stays missing, without an error.
        const v = value(source, scope, false);
        if (v !== undefined) vars[param.name] = v;
      }
    }
    if (item.children.length > 0 && !def.hasBlock) err(`"${def.name}" has no "block", so the children of this call would be lost`, item.loc);
    if (problems.length > before) return;

    const body: Scope = {
      vars,
      items: new Map(),
      guards: {},
      block: { children: item.children, scope, at: { ...at, path } },
      stack: [...scope.stack, def.name],
    };
    walk(def.children, body, { origin: at.origin + path.join('/') + '>', path: [], keys: at.keys }, { out: target.out });
  }

  // ---- go ---------------------------------------------------------------------------
  const tree: OutNode[] = [];
  const root: Scope = { vars: options.inputs ?? {}, items: new Map(), guards: {}, stack: [] };
  walk(document.nodes, root, { origin: '', path: [], keys: [] }, { out: tree });

  const seen = new Set<string>();
  const unique = problems
    .filter((p) => {
      const id = `${p.line}:${p.column}:${p.message}`;
      return !seen.has(id) && !!seen.add(id);
    })
    .sort((a, b) => a.line - b.line || a.column - b.column);
  return { tree, problems: unique };
}
