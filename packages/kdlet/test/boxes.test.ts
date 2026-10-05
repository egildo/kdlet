/**
 * The language against a made-up renderer that is not HTML: boxes and text,
 * addresses taken from the first argument, a list-valued field written as a
 * child node, replace-only fields and one host tag.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defineVocabulary, evaluate, read } from '../src/index.js';
import type { OutNode } from '../src/index.js';
import { assertUnique, boxes, flatten, shape } from './helpers.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const evalBoxes = (text: string, inputs: Record<string, unknown> = {}, words?: string[]) =>
  evaluate(read(text, { words }), { vocabulary: boxes, inputs });

const find = (tree: OutNode[], address: string): OutNode => flatten(tree).find((n) => n.identity.address === address) as OutNode;

for (const extension of ['kdl', 'kdlet']) {
  test(`switch.${extension}: a child-node field under a when, in the vocabulary's own words`, () => {
    const document = read(fixture(`switch.${extension}`));
    assert.deepEqual(document.problems, []);

    const off = evaluate(document, { vocabulary: boxes, inputs: { state: 'off', label: 'Show label' } });
    const on = evaluate(document, { vocabulary: boxes, inputs: { state: 'on', label: 'Show label' } });
    assert.deepEqual([off.problems, on.problems], [[], []]);

    // The field replaces; the when's property replaces the line's.
    assert.deepEqual(find(off.tree, 'Track').fields, { direction: 'ROW', align: 'START', width: { tag: 'literal', value: 40 }, EDGES: ['left', 'right'] });
    assert.deepEqual(find(on.tree, 'Track').fields, { direction: 'ROW', align: 'END', width: { tag: 'literal', value: 40 }, EDGES: ['left', 'right', 'inner'] });
    assert.deepEqual(find(on.tree, 'Track').fieldLocs.EDGES, { line: 6, column: 29 });
  });
}

test('addresses are in the identity, along with place and keys', () => {
  const r = evalBoxes(fixture('switch.kdl'), { state: 'on', label: 'L' });
  assert.deepEqual(
    flatten(r.tree).map((n) => [n.name, n.identity]),
    [
      ['BOX', { place: '1', keys: [], address: 'Toggle' }],
      ['BOX', { place: '1/0', keys: [], address: 'Track' }],
      ['BOX', { place: '1/0/2', keys: [], address: 'Thumb' }],
      ['TEXT', { place: '1/1', keys: [], address: 'Caption' }],
    ],
  );
});

test('host tags pass through untouched as tagged values', () => {
  const r = evalBoxes(fixture('switch.kdl'), { state: 'off', label: 'L' });
  assert.deepEqual(find(r.tree, 'Toggle').fields.gap, { tag: 'literal', value: 8 });
  assert.deepEqual(find(r.tree, 'Thumb').fields.width, { tag: 'literal', value: 20 });
});

test('a child-node field written with arguments only holds the list of them, references included', () => {
  const r = evalBoxes('BOX B {\n  EDGES (input)a (input)b\n}', { a: 'x', b: 'y' });
  assert.deepEqual(find(r.tree, 'B').fields, { EDGES: ['x', 'y'] });
  assert.deepEqual(evalBoxes('BOX B {\n  EDGES\n}').tree[0].fields, { EDGES: [] });
});

test('a child-node field written with properties holds a structure, with positions', () => {
  const r = evalBoxes('BOX B {\n  PLACE row=0 column=(input)c note=(literal)1\n}', { c: 2 });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(find(r.tree, 'B').fields.PLACE, {
    name: 'PLACE',
    args: [],
    props: { row: 0, column: 2, note: { tag: 'literal', value: 1 } },
    children: [],
    loc: { line: 2, column: 3 },
    argLocs: [],
    propLocs: { row: { line: 2, column: 9 }, column: { line: 2, column: 15 }, note: { line: 2, column: 31 } },
  });
  assert.deepEqual(find(r.tree, 'B').fieldLocs.PLACE, { line: 2, column: 3 });
});

test('a child-node field written with children holds nested structures: arguments, properties and further nodes', () => {
  const r = evalBoxes('BOX B {\n  TRACKS {\n    STRETCH\n    STRETCH (input)w\n    SIZE 40 unit=px {\n      NOTE deep\n    }\n  }\n}', { w: 1.5 });
  assert.deepEqual(r.problems, []);
  const tracks = find(r.tree, 'B').fields.TRACKS as { children: { name: string; args: unknown[]; props: unknown; children: { name: string; args: unknown[] }[]; argLocs: unknown[] }[] };
  assert.deepEqual(tracks.children.map((c) => [c.name, c.args, c.props]), [
    ['STRETCH', [], {}],
    ['STRETCH', [1.5], {}],
    ['SIZE', [40], { unit: 'px' }],
  ]);
  assert.deepEqual(tracks.children[1].argLocs, [{ line: 4, column: 13 }]);
  assert.deepEqual(tracks.children[2].children.map((c) => [c.name, c.args]), [['NOTE', ['deep']]]);
});

test('a structure is plain JSON, and travels', () => {
  const r = evalBoxes('BOX B {\n  PLACE row=0\n  TRACKS { STRETCH 1 }\n}');
  assert.deepEqual(JSON.parse(JSON.stringify(r.tree)), r.tree);
});

test('a reference or a host tag inside a structure behaves as anywhere: a missing value is an error at its own position, an unknown tag too', () => {
  const missing = evalBoxes('BOX B {\n  TRACKS {\n    STRETCH (input)w\n  }\n}');
  assert.deepEqual(missing.problems.map((p) => `${p.line}:${p.column}`), ['3:13']);
  assert.match(missing.problems[0].message, /\(input\)w has no value/);
  const tag = evalBoxes('BOX B {\n  PLACE row=(px)1\n}');
  assert.deepEqual(tag.problems.map((p) => `${p.line}:${p.column}`), ['2:9']);
  assert.match(tag.problems[0].message, /unknown tag "\(px\)"/);
});

test('a structure holds plain nodes: a when, an each or a call inside it is refused, where it stands', () => {
  for (const [body, word] of [['when g { STRETCH }', 'when'], ['each x in=(input)xs key=k { STRETCH }', 'each'], ['+Row', 'call']] as const) {
    const r = evalBoxes(`guard g { has (input)xs }\nBOX B {\n  TRACKS {\n    ${body}\n  }\n}`, { xs: [{ k: 1 }] });
    assert.deepEqual(r.problems.map((p) => `${p.line}:${p.column}`), ['4:5'], word);
    assert.match(r.problems[0].message, new RegExp(`holds plain nodes; "${word}" has no place in it`));
  }
});

test('a structure follows the replace rule: a later write replaces it whole, a when included', () => {
  const r = evalBoxes('guard on { is (input)state on }\nBOX B {\n  TRACKS { STRETCH; STRETCH }\n  when on { TRACKS { SIZE 8 } }\n}', { state: 'on' });
  const tracks = find(r.tree, 'B').fields.TRACKS as { children: { name: string }[] };
  assert.deepEqual(tracks.children.map((c) => c.name), ['SIZE']);
  assert.deepEqual(find(r.tree, 'B').fieldLocs.TRACKS, { line: 4, column: 13 });
  const off = evalBoxes('guard on { is (input)state on }\nBOX B {\n  TRACKS { STRETCH; STRETCH }\n  when on { TRACKS { SIZE 8 } }\n}', { state: 'off' });
  assert.deepEqual((find(off.tree, 'B').fields.TRACKS as { children: unknown[] }).children.length, 2);
});

test('a field that adds takes a structure as one more item, after the list its earlier arguments made', () => {
  const adding = defineVocabulary({ elements: ['BOX'], childFields: ['EDGES'], adds: ['EDGES'] });
  const r = evaluate(read('BOX B {\n  EDGES a b\n  EDGES c side=left\n}'), { vocabulary: adding });
  assert.deepEqual(r.problems, []);
  const edges = r.tree[0].fields.EDGES as unknown[];
  assert.equal(edges.length, 3);
  assert.deepEqual(edges.slice(0, 2), ['a', 'b']);
  assert.deepEqual((edges[2] as { args: unknown[]; props: unknown }).props, { side: 'left' });
});

test('a child field stands directly in an element; (element) makes it an element', () => {
  const inEach = evalBoxes('BOX B { each x in=(input)xs key=k { EDGES a } }', { xs: [{ k: 1 }] });
  assert.match(inEach.problems[0].message, /"EDGES" is a field of its element/);
  const forced = evalBoxes('BOX B { (element)EDGES a }');
  assert.match(forced.problems[0].message, /"EDGES" is not an element of this vocabulary/);
});

test('the host\'s top-level words are handed back and never evaluated', () => {
  const document = read('settings theme=dark\nBOX Root', { words: ['settings'] });
  assert.deepEqual(document.problems, []);
  const [word] = document.nodes;
  assert.equal(word.kind, 'host');
  assert.equal(word.kind === 'host' && word.node.getProperty('theme'), 'dark');
  const r = evaluate(document, { vocabulary: boxes });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.tree.map((n) => [n.identity.address, n.identity.place]), [['Root', '1']]);
});

test('a call no definition was supplied for passes through, and has no address', () => {
  const r = evalBoxes('BOX Row {\n  +Icon name=chevron size=(literal)16\n}');
  assert.deepEqual(r.problems, []);
  const [call] = r.tree[0].children;
  assert.deepEqual(
    { kind: call.kind, name: call.name, fields: call.fields, identity: call.identity },
    { kind: 'call', name: 'Icon', fields: { name: 'chevron', size: { tag: 'literal', value: 16 } }, identity: { place: '0/0', keys: [] } },
  );
});

test('one document, evaluated once per combination of two inputs, gives four trees with stable places', () => {
  const document = read(`guard on { is (input)state on }
guard big { is (input)size large }
BOX Root {
    BOX Label
    when on { BOX Active }
    when big { BOX Large }
    BOX Tail
}`);
  const combinations = [];
  for (const state of ['on', 'off']) {
    for (const size of ['small', 'large']) {
      const r = evaluate(document, { vocabulary: boxes, inputs: { state, size } });
      assert.deepEqual(r.problems, []);
      assertUnique(r.tree);
      combinations.push(r.tree);
    }
  }
  // Four different trees ...
  assert.equal(new Set(combinations.map((t) => JSON.stringify(shape(t)))).size, 4);
  assert.deepEqual(combinations.map((t) => t[0].children.map((c) => c.identity.address)), [
    ['Label', 'Active', 'Tail'],
    ['Label', 'Active', 'Large', 'Tail'],
    ['Label', 'Tail'],
    ['Label', 'Large', 'Tail'],
  ]);
  // ... in which every node that is present has the place it has everywhere else.
  const places = new Map<string, Set<string>>();
  for (const tree of combinations) {
    for (const n of flatten(tree)) {
      const seen = places.get(n.identity.address as string) ?? new Set();
      places.set(n.identity.address as string, seen.add(n.identity.place));
    }
  }
  assert.deepEqual(Object.fromEntries([...places].map(([a, p]) => [a, [...p]])), {
    Root: ['2'], Label: ['2/0'], Active: ['2/1/0'], Large: ['2/2/0'], Tail: ['2/3'],
  });
});

test('tracks.kdlet: the manual\'s example reads a structure with nested nodes and a placement', () => {
  const r = evaluate(read(fixture('tracks.kdlet')), { vocabulary: boxes });
  assert.deepEqual(r.problems, []);
  const tracks = find(r.tree, 'Table').fields.TRACKS as { children: { name: string; args: unknown[] }[] };
  assert.deepEqual(tracks.children.map((c) => [c.name, c.args]), [['STRETCH', []], ['SIZE', [40]], ['STRETCH', [1.5]]]);
  assert.deepEqual((find(r.tree, 'Cell').fields.PLACE as { props: unknown }).props, { row: 0, column: 1 });
});
