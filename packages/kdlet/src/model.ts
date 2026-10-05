/**
 * The types of kdlet: the source document a file reads into, the vocabulary a
 * renderer supplies, and the plain tree evaluation produces.
 *
 * The source types keep positions beside the data they describe, so a problem
 * found at evaluation still points at the line that caused it. The output types
 * are plain JSON all the way down.
 */

import type { Node as KdlNode } from '@bgotink/kdl';
import type { Condition, Json, Loc, Primitive, Problem, Ref } from 'kdlet-guards';

/*
 * A position, a problem (everything wrong is an error; one run reports all of it), a KDL value, plain JSON and
 * a reference are the guards' own: the language uses the module's, so the two cannot drift.
 */
export type { Condition, Json, Loc, Primitive, Problem, Ref };

// ---------------------------------------------------------------------------
// Source
// ---------------------------------------------------------------------------

/** A KDL value as written. `ref` is set when the tag makes it a reference. */
export interface Value {
  tag: string | null;
  value: Primitive;
  loc: Loc;
  ref?: Ref;
}

/** A name the file uses (a guard, a parameter), with where it was written. */
export interface Name {
  name: string;
  loc: Loc;
}

export interface Prop {
  name: string;
  value: Value;
  loc: Loc;
}

export interface Param {
  name: string;
  /** Present for an optional parameter. */
  default?: Value;
  loc: Loc;
}

interface Base {
  /** Where the node stands among its parent's nodes in the file: the unit of a place. */
  index: number;
  loc: Loc;
}

export type Item = Base &
  (
    | {
        kind: 'element';
        name: string;
        /** Written `(element)name`: never a field, never a reserved word. */
        forced: boolean;
        args: Value[];
        props: Prop[];
        children: Item[];
      }
    | { kind: 'when'; guards: Name[]; props: Prop[]; children: Item[] }
    | {
        kind: 'else';
        /** What the `else` follows: a `when` (or a chain of them), or an `each`. */
        follows: 'when' | 'each';
        guards: Name[];
        props: Prop[];
        children: Item[];
      }
    | { kind: 'each'; item: string; list: Value; key: string; keyLoc: Loc; children: Item[] }
    | { kind: 'guard'; name: string; /** Absent: the host supplies it. Several are all of them. */ body?: Condition[] }
    | { kind: 'define'; name: string; params: Param[]; hasBlock: boolean; children: Item[] }
    | { kind: 'call'; name: string; props: Prop[]; children: Item[] }
    | { kind: 'block' }
    | { kind: 'host'; name: string; node: KdlNode }
  );

/** What `read` returns: the file's nodes and every problem found reading it. */
export interface Document {
  /** The top-level nodes, in file order, `define`s and host words included. */
  nodes: Item[];
  problems: Problem[];
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** What an evaluated node looks like to a vocabulary, once its line and children are read. */
export interface NodeSummary {
  element: string;
  args: Json[];
  fields: Record<string, Json>;
}

/** What a renderer supplies. See `defineVocabulary`. */
export interface Vocabulary {
  /** The element names that exist, or `'*'` when any name is accepted. */
  elements: readonly string[] | '*';
  /**
   * How a node name is read. Returns the element, and any fields the name
   * itself writes (written first, before the node's properties), or a problem.
   * Default: the name is the element.
   */
  readName?(name: string): { element: string; fields?: [string, Json][] } | { problem: string };
  /**
   * Child node names that are fields of their element, not child elements. Written with arguments only,
   * `name value…`, a field holds the list of its arguments. Written with properties or children, it holds a
   * `Structure`.
   */
  childFields?: readonly string[];
  /** Fields where a later write adds to the earlier ones (a structure is added as one item). Every other field is replaced. */
  adds?: readonly string[];
  /** How a node's address is found, if the renderer has addresses. */
  address?(node: NodeSummary): string | undefined;
  /** Host tags: `(literal)8` is kept as `{ tag: 'literal', value: 8 }`. */
  tags?: readonly string[];
}

/** What a host guard sees: the inputs (or parameters) and the items in scope where it was written. */
export interface GuardScope {
  inputs: Record<string, unknown>;
  items: Record<string, Record<string, unknown>>;
}

export type GuardFn = (scope: GuardScope) => boolean;

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export type Key = string | number;

/**
 * A field written as a child node that carries properties or children: the node's arguments, properties and
 * nested nodes as plain JSON, with the position of each. A nested node has the same shape. References and host
 * tags inside it behave as everywhere else.
 */
export type Structure = {
  /** The node's name: the field's own name at the top, the nested node's name below. */
  name: string;
  args: Json[];
  props: Record<string, Json>;
  children: Structure[];
  loc: Loc;
  argLocs: Loc[];
  propLocs: Record<string, Loc>;
};

/** How a renderer finds the same node again. `place` and `keys` together are unique in a tree. */
export interface Identity {
  /** Where the node is written in the template. `3>0/1` is the second child of the first node of what the call at `3` expanded to. */
  place: string;
  /** The keys of the enclosing `each`es, outermost first. */
  keys: Key[];
  /** The renderer's own name for the node, when its vocabulary gives one. */
  address?: string;
}

export interface OutNode {
  /** `call` is a call that no definition was supplied for. */
  kind: 'element' | 'call';
  /** The element, or the name of the definition that was not expanded. */
  name: string;
  identity: Identity;
  args: Json[];
  /** A field written once holds its value; one that adds holds a list; one written as a child node holds the list of its arguments, or a `Structure` when it carries properties or children. */
  fields: Record<string, Json>;
  children: OutNode[];
  loc: Loc;
  argLocs: Loc[];
  fieldLocs: Record<string, Loc>;
}
