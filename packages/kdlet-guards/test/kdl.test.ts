import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@bgotink/kdl';
import { evaluate } from '../src/index.js';
import type { Condition, Host } from '../src/index.js';
import { readBody, readGuard, readRef, writeGuard } from '../src/kdl.js';
import type { ReadOptions } from '../src/kdl.js';

const nodesOf = (text: string) => parse(text, { storeLocations: true }).nodes;

/** The conditions of a body, and the problems as `line:column message`. */
function body(text: string, options: ReadOptions = {}) {
  const { conditions, problems } = readBody(nodesOf(text), options);
  return { conditions, lines: problems.map((p) => `${p.line}:${p.column} ${p.message}`) };
}

/** One problem, at this position, saying this. */
function refused(text: string, at: string, message: RegExp, options: ReadOptions = {}): void {
  const { lines } = body(text, options);
  assert.equal(lines.length, 1, `expected one problem, got:\n${lines.join('\n')}`);
  assert.match(lines[0], new RegExp(`^${at} `));
  assert.match(lines[0], message);
}

const bare = (c: Condition | Condition[]): unknown => JSON.parse(JSON.stringify(c, (key, value) => (key === 'loc' ? undefined : value)));

// kdlet's guard examples: the manual's guards and the ones of its worked examples.
const EXAMPLES = [
  'is (post)kind featured',
  'has (post)summary',
  'not featured',
  'is (link)href (input)path',
  'is (input)State hover pressed',
  'is (input)b #true',
  'is (input)n 1',
  'is (input)s a "two words" #null 2.5',
  'all {\n    has (post)kind\n    is (post)kind featured\n}',
  'any {\n    has (input)a\n    has (input)b\n}',
  'all {\n    any {\n        is (input)x 1\n        not pricey\n    }\n    has (input)y\n}',
];

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

test('every word reads into the model, with the position of its node and of its references', () => {
  const { conditions, lines } = body('is (input)kind featured (post)kind\nhas (post)summary\nnot featured\nall { has (input)a }\nany { has (input)b; has (input)c }');
  assert.deepEqual(lines, []);
  assert.deepEqual(conditions, [
    {
      is: { ref: { from: 'input', field: 'kind' }, loc: { line: 1, column: 4 } },
      values: ['featured', { ref: { from: 'post', field: 'kind' }, loc: { line: 1, column: 25 } }],
      loc: { line: 1, column: 1 },
    },
    { has: { ref: { from: 'post', field: 'summary' }, loc: { line: 2, column: 5 } }, loc: { line: 2, column: 1 } },
    { not: { guard: 'featured', loc: { line: 3, column: 5 } }, loc: { line: 3, column: 1 } },
    { all: [{ has: { ref: { from: 'input', field: 'a' }, loc: { line: 4, column: 11 } }, loc: { line: 4, column: 7 } }], loc: { line: 4, column: 1 } },
    {
      any: [
        { has: { ref: { from: 'input', field: 'b' }, loc: { line: 5, column: 11 } }, loc: { line: 5, column: 7 } },
        { has: { ref: { from: 'input', field: 'c' }, loc: { line: 5, column: 25 } }, loc: { line: 5, column: 21 } },
      ],
      loc: { line: 5, column: 1 },
    },
  ]);
});

test('readGuard reads one node', () => {
  const { condition, problems } = readGuard(nodesOf('has (input)x')[0]);
  assert.deepEqual([condition && bare(condition), problems], [{ has: { ref: { from: 'input', field: 'x' } } }, []]);
  assert.equal(readGuard(nodesOf('nonsense')[0]).condition, undefined);
});

test('a read condition is evaluated with positions that point back into the text', () => {
  const { conditions } = body('is (input)s a');
  const host: Host = { resolve: () => undefined, missing: 'error' };
  const t = evaluate(conditions[0], host);
  assert.deepEqual(t.errors?.[0].loc, { line: 1, column: 4 });
});

test('a body takes the words of the language, shaped right', () => {
  refused('when x', '1:1', /a guard's body takes is, has, not, all, any and guard, not "when"/);
  refused('is "a" b', '1:4', /starts with a reference/);
  refused('is (input)a', '1:1', /"is" takes a reference and at least one value/);
  refused('has (input)a (input)b', '1:1', /"has" takes one reference/);
  refused('all { }', '1:1', /"all" needs a body/);
  refused('not', '1:1', /"not" takes the name of one guard, or a body/);
  refused('not a b', '1:1', /"not" takes the name of one guard, or a body/);
  refused('guard', '1:1', /"guard" takes the name of one guard/);
  refused('(x)is (input)a b', '1:1', /"is" takes no tag/);
  refused('is (input)a b x=1', '1:15', /is takes no properties/);
  refused('has (input)a { x }', '1:16', /has takes no body/);
  assert.deepEqual(body('is (input)a b x=1 x=2').lines, ['1:19 "x" is written twice on is; KDL would keep only the last', '1:15 is takes no properties']);
});

test('a reference names one field, as text', () => {
  refused('has (post)author.name', '1:5', /single field/);
  refused('has (post)1', '1:5', /a reference names a field with text/);
  refused('is (input)a (post)""', '1:13', /a reference names a field with text/);
});

test('a tag is a reference unless the host says it is not; then it is refused where it stands', () => {
  const isReference = (tag: string) => tag === 'input';
  refused('is (input)a (literal)1', '1:13', /"is" compares plain values and references, not \(literal\) values/, { isReference });
  refused('has (post)x', '1:5', /starts with a reference such as \(input\)name or \(item\)field, not \(post\)"x"/, { isReference });
  assert.deepEqual(body('is (input)a 1', { isReference }).lines, []);
});

test('the host can say which guard names are visible', () => {
  const checkGuard = (name: string) => (name === 'seen' ? undefined : `no guard named "${name}" here`);
  refused('not seen2', '1:5', /no guard named "seen2" here/, { checkGuard });
  assert.deepEqual(body('not seen', { checkGuard }).lines, []);
});

test('guardNames: a name stands anywhere by default, and under not alone when the host says so', () => {
  assert.deepEqual(bare(body('guard a\nnot { has (input)x }\nnot { has (input)x; has (input)y }').conditions), [
    { guard: 'a' },
    { not: { has: { ref: { from: 'input', field: 'x' } } } },
    { not: { all: [{ has: { ref: { from: 'input', field: 'x' } } }, { has: { ref: { from: 'input', field: 'y' } } }] } },
  ]);
  const strict: ReadOptions = { guardNames: 'under-not' };
  refused('guard a', '1:1', /a guard's body takes is, has, not, all and any, not "guard"/, strict);
  assert.deepEqual(body('not { has (input)x }', strict).lines, ['1:7 not takes no body', '1:1 "not" takes the name of one guard']);
  refused('not a { has (input)x }', '1:9', /not takes no body/, strict);
  assert.deepEqual(bare(body('not a', strict).conditions), [{ not: { guard: 'a' } }]);
});

test('registered words: arguments as a list or as properties, and a body of conditions', () => {
  const words = ['entry', 'at-least'];
  assert.deepEqual(body('entry kind=memo n=2\nat-least 2 {\n  has (input)a\n  entry\n}', { words }).lines, []);
  assert.deepEqual(bare(body('entry kind=memo n=1\nat-least 2 { has (input)a; entry }', { words }).conditions), [
    { word: 'entry', args: { kind: 'memo', n: 1 } },
    { word: 'at-least', args: [2], body: [{ has: { ref: { from: 'input', field: 'a' } } }, { word: 'entry' }] },
  ]);
  refused('entry a b=1', '1:1', /"entry" takes arguments or properties, not both/, { words });
  refused('entry (x)1', '1:7', /"entry" takes plain values; the tag on \(x\)1 means nothing here/, { words });
  refused('other', '1:1', /a guard's body takes is, has, not, all, any, guard, entry and at-least, not "other"/, { words });
});

test('one run reports every problem, in order', () => {
  const { lines } = body('is (input)a\nwhen x\nhas (input)a (input)b');
  assert.deepEqual(lines.map((l) => l.split(' ')[0]), ['1:1', '2:1', '3:1']);
});

test('a nested condition with a part that could not be read is left out whole, not read narrower', () => {
  for (const text of ['not {\n    bogus\n}', 'all {\n    bogus\n    has (input)a\n}', 'any {\n    bogus\n}', 'is (input)a x (input)""']) {
    const { conditions, lines } = body(text, { words: [] });
    assert.deepEqual(conditions, [], text);
    assert.ok(lines.length > 0, text);
  }
});

test('readRef: a field named as text, once', () => {
  assert.deepEqual(readRef('input', 'a'), { ref: { from: 'input', field: 'a' } });
  assert.match((readRef('input', 'a.b') as { problem: string }).problem, /single field/);
  assert.match((readRef('input', 3) as { problem: string }).problem, /with text/);
});

// ---------------------------------------------------------------------------
// Writing, and the round trip
// ---------------------------------------------------------------------------

test("kdlet's guard examples are written as they were read", () => {
  for (const text of EXAMPLES) {
    const { conditions, lines } = body(text);
    assert.deepEqual(lines, [], text);
    assert.equal(conditions.length, 1, text);
    assert.equal(writeGuard(conditions[0]), text);
  }
});

test('read, write and read again give the same condition, positions apart', () => {
  const words = ['entry', 'at-least'];
  const texts = [
    ...EXAMPLES,
    'guard featured',
    'not {\n    any {\n        has (input)a\n        guard b\n    }\n}',
    'entry kind=memo n=1 ok=#true',
    'at-least 2 {\n    has (input)a\n    entry kind=memo\n    not b\n}',
    'at-least 1 "two words" #null',
  ];
  for (const text of texts) {
    const first = body(text, { words });
    assert.deepEqual(first.lines, [], text);
    const written = writeGuard(first.conditions[0]);
    const second = body(written, { words });
    assert.deepEqual(second.lines, [], written);
    assert.deepEqual(bare(second.conditions), bare(first.conditions), text);
    assert.equal(writeGuard(second.conditions[0]), written);
  }
});

test('a condition built in code is written, and the model written is the model read', () => {
  const c: Condition = { all: [{ not: { all: [{ has: { ref: { from: 'a', field: 'x' } } }, { is: { ref: { from: 'a', field: 'b' } }, values: ['c'] }] } }, { word: 'w', args: [1, 'z'] }] };
  const text = writeGuard(c);
  assert.equal(text, 'all {\n    not {\n        all {\n            has (a)x\n            is (a)b c\n        }\n    }\n    w 1 z\n}');
  assert.deepEqual(bare(body(text, { words: ['w'] }).conditions), [c]);
});

test('a word whose arguments KDL cannot hold is refused when written, not written wrong', () => {
  assert.throws(() => writeGuard({ word: 'w', args: { nested: { a: 1 } } }), RangeError);
  assert.throws(() => writeGuard({ word: 'w', args: [[1]] }), RangeError);
  assert.throws(() => writeGuard({ word: 'w', args: 'bare' }), RangeError);
});
