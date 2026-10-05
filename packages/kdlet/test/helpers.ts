import { defineVocabulary, evaluate, read } from '../src/index.js';
import type { EvaluateOptions, Evaluation, GuardFn, OutNode, Vocabulary } from '../src/index.js';

/** Any element name, `class` adds: enough to exercise the language itself. */
export const plain: Vocabulary = defineVocabulary({ elements: '*', adds: ['class'] });

/**
 * A made-up renderer for boxes and text. The first argument is the node's
 * address, `EDGES` is a list-valued field written as a child node, `PLACE` and
 * `TRACKS` are fields written as child nodes that carry properties or children,
 * every field replaces, and `literal` is its one tag.
 */
export const boxes: Vocabulary = defineVocabulary({
  elements: ['BOX', 'TEXT'],
  childFields: ['EDGES', 'PLACE', 'TRACKS'],
  address: (node) => (typeof node.args[0] === 'string' ? node.args[0] : undefined),
  tags: ['literal'],
});

export interface Run extends Evaluation {
  /** Problems as `line:column message`, for short assertions. */
  lines: string[];
}

export function run(text: string, options: Partial<EvaluateOptions> & { words?: string[] } = {}): Run {
  const { words, ...rest } = options;
  const document = read(text, { words });
  const result = evaluate(document, { vocabulary: plain, ...rest });
  return { ...result, lines: result.problems.map((p) => `${p.line}:${p.column} ${p.message}`) };
}

export const guards = (fns: Record<string, GuardFn>): Record<string, GuardFn> => fns;

/** Every node of a tree, depth first. */
export function flatten(tree: OutNode[]): OutNode[] {
  return tree.flatMap((n) => [n, ...flatten(n.children)]);
}

/** Place and keys together identify a node: no two nodes of a tree may share them. */
export function assertUnique(tree: OutNode[]): string[] {
  const ids = flatten(tree).map((n) => `${n.identity.place} ${JSON.stringify(n.identity.keys)}`);
  if (new Set(ids).size !== ids.length) throw new Error(`identities collide: ${ids.join(' | ')}`);
  return ids;
}

/** A tree without positions, for comparing shape. */
export function shape(tree: OutNode[]): unknown[] {
  return tree.map((n) => ({
    kind: n.kind,
    name: n.name,
    args: n.args,
    fields: n.fields,
    children: shape(n.children),
  }));
}
