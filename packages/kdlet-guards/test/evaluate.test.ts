import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errors, evaluate, problems } from '../src/index.js';
import type { Condition, Host, Json, Ref, Trace, Word } from '../src/index.js';

/** A host that reads its references from plain records: `(input)x` is `data.input.x`. */
function host(data: Record<string, Record<string, unknown>>, rest: Partial<Host> = {}): Host {
  return { resolve: (ref: Ref) => data[ref.from]?.[ref.field], missing: 'error', ...rest };
}

const input = (field: string, loc?: { line: number; column: number }) => ({ ref: { from: 'input', field }, ...(loc ? { loc } : {}) });
const holds = (c: Condition, h: Host): boolean => evaluate(c, h).holds;

// ---------------------------------------------------------------------------
// The words of the language
// ---------------------------------------------------------------------------

test('is: equal to any of the values, which may be references; equality is strict', () => {
  const c: Condition = { is: input('s'), values: ['a', 'b'] };
  assert.equal(holds(c, host({ input: { s: 'b' } })), true);
  assert.equal(holds(c, host({ input: { s: 'z' } })), false);
  const two: Condition = { is: input('s'), values: [input('t')] };
  assert.equal(holds(two, host({ input: { s: 'b', t: 'b' } })), true);
  assert.equal(holds(two, host({ input: { s: 'b', t: 'c' } })), false);
  const num: Condition = { is: input('n'), values: [1] };
  assert.equal(holds(num, host({ input: { n: 1 } })), true);
  assert.equal(holds(num, host({ input: { n: '1' } })), false);
  assert.equal(holds({ is: input('b'), values: [true] }, host({ input: { b: true } })), true);
  assert.equal(holds({ is: input('b'), values: [true] }, host({ input: { b: 'true' } })), false);
});

test('is: null is a value, absent is not', () => {
  const c: Condition = { is: input('x'), values: [null] };
  assert.equal(holds(c, host({ input: { x: null } })), true);
  assert.equal(holds(c, host({ input: {} }, { missing: 'false' })), false);
});

test('is: a plain value on the left reads like a reference', () => {
  assert.equal(holds({ is: 'a', values: [input('x')] }, host({ input: { x: 'a' } })), true);
});

test('has: what counts as something to show', () => {
  const h = (value: unknown) => holds({ has: input('x') }, host({ input: { x: value } }));
  for (const [value, expected] of [
    [undefined, false],
    [null, false],
    ['', false],
    [[], false],
    [0, true],
    [false, true],
    ['a', true],
    [[1], true],
    [{}, true],
  ] as const) {
    assert.equal(h(value), expected, `has ${JSON.stringify(value)}`);
  }
  assert.equal(holds({ has: 'text' }, host({})), true);
  assert.equal(holds({ has: '' }, host({})), false);
});

test('not, all and any', () => {
  const yes: Condition = { has: 'x' };
  const no: Condition = { has: null };
  const h = host({});
  assert.equal(holds({ not: yes }, h), false);
  assert.equal(holds({ not: no }, h), true);
  assert.equal(holds({ all: [yes, yes] }, h), true);
  assert.equal(holds({ all: [yes, no] }, h), false);
  assert.equal(holds({ any: [no, yes] }, h), true);
  assert.equal(holds({ any: [no, no] }, h), false);
  assert.equal(holds({ all: [] }, h), true);
  assert.equal(holds({ any: [] }, h), false);
});

test('all and any stop at the first child that settles them, and the trace has only those asked', () => {
  const asked: string[] = [];
  const spy = (name: string, answer: boolean) => (): boolean => (asked.push(name), answer);
  const h = host({}, { guards: { a: spy('a', false), b: spy('b', true), c: spy('c', true) } });
  const all = evaluate({ all: [{ guard: 'a' }, { guard: 'b' }] }, h);
  assert.deepEqual([all.holds, asked, all.children?.length], [false, ['a'], 1]);
  asked.length = 0;
  const any = evaluate({ any: [{ guard: 'a' }, { guard: 'b' }, { guard: 'c' }] }, h);
  assert.deepEqual([any.holds, asked, any.children?.length], [true, ['a', 'b'], 2]);
});

test('a trace gives every node its result, so a caller can tick each condition', () => {
  const c: Condition = { all: [{ has: input('a') }, { not: { has: input('b') } }] };
  const t = evaluate(c, host({ input: { a: 1, b: 2 } }));
  assert.equal(t.holds, false);
  assert.equal(t.condition, c);
  assert.deepEqual(
    t.children?.map((x) => x.holds),
    [true, false],
  );
  assert.deepEqual(t.children?.[1].children?.map((x) => x.holds), [true]);
});

// ---------------------------------------------------------------------------
// Missing
// ---------------------------------------------------------------------------

test("missing: 'error' records an error where the operand stands, and the node does not hold", () => {
  const at = { line: 3, column: 14 };
  const t = evaluate({ is: input('s', at), values: ['a'] }, host({}));
  assert.equal(t.holds, false);
  assert.deepEqual(t.errors, [{ message: '(input)s has no value here; ask with "has" before comparing it', loc: at }]);
  assert.deepEqual(errors(t), t.errors);
});

test("missing: 'error' reports an absent value on the right too, each one, and the left alone when it is absent", () => {
  const right = { line: 1, column: 23 };
  const t = evaluate({ is: input('s'), values: [input('t', right), input('u')] }, host({ input: { s: 'a' } }));
  assert.deepEqual(
    t.errors?.map((e) => e.message),
    ['(input)t has no value here; ask with "has" before comparing it', '(input)u has no value here; ask with "has" before comparing it'],
  );
  assert.deepEqual(t.errors?.[0].loc, right);
  const left = evaluate({ is: input('s'), values: [input('t')] }, host({}));
  assert.equal(left.errors?.length, 1);
});

test("missing: 'false' never records anything, and has is the same either way", () => {
  const h = host({}, { missing: 'false' });
  const t = evaluate({ all: [{ is: input('s'), values: ['a', input('t')] }] }, h);
  assert.equal(t.holds, false);
  assert.deepEqual(errors(t), []);
  assert.equal(holds({ not: { is: input('s'), values: ['a'] } }, h), true);
  assert.equal(holds({ has: input('s') }, h), false);
});

test('an error under not leaves the child false, so not holds, and the error stays in the trace', () => {
  const t = evaluate({ not: { is: input('s'), values: ['a'] } }, host({}));
  assert.equal(t.holds, true);
  assert.equal(errors(t).length, 1);
});

// ---------------------------------------------------------------------------
// Named guards
// ---------------------------------------------------------------------------

test('a named guard is a condition of the host, and its trace is a child', () => {
  const h = host({ input: { kind: 'featured' } }, { guards: { featured: { is: input('kind'), values: ['featured'] }, ordinary: { not: { guard: 'featured' } } } });
  const t = evaluate({ guard: 'ordinary' }, h);
  assert.equal(t.holds, false);
  assert.deepEqual(t.children?.[0].condition, { not: { guard: 'featured' } });
  assert.equal(t.children?.[0].children?.[0].children?.[0].holds, true);
});

test('a guard may be a function of the host; it answers true or false, or says why it cannot', () => {
  const h = host(
    { input: { limit: 10 } },
    {
      guards: {
        big: (host) => (host.resolve({ from: 'input', field: 'limit' }) as number) > 5,
        broken: () => ({ error: 'the host has none' }),
        wrong: (() => 'yes') as never,
      },
    },
  );
  assert.equal(holds({ guard: 'big' }, h), true);
  const broken = evaluate({ guard: 'broken', loc: { line: 2, column: 10 } }, h);
  assert.deepEqual([broken.holds, broken.errors], [false, [{ message: 'the host has none', loc: { line: 2, column: 10 } }]]);
  assert.match(errors(evaluate({ guard: 'wrong' }, h))[0].message, /the host's guard "wrong" returned string, not true or false/);
});

test('an unknown guard is an error at the reference, not a throw', () => {
  const t = evaluate({ not: { guard: 'ghost', loc: { line: 1, column: 5 } } }, host({}));
  assert.equal(t.holds, true);
  assert.deepEqual(errors(t), [{ message: 'no guard named "ghost"', loc: { line: 1, column: 5 } }]);
  // a name that is on Object's prototype is not a guard
  assert.match(errors(evaluate({ guard: 'toString' }, host({}, { guards: {} })))[0].message, /no guard named "toString"/);
});

test('guards that depend on themselves are an error where the loop closes, not a hang', () => {
  const h = host({}, { guards: { a: { not: { guard: 'b', loc: { line: 1, column: 15 } } }, b: { not: { guard: 'a', loc: { line: 2, column: 15 } } } } });
  const t = evaluate({ guard: 'a' }, h);
  assert.deepEqual(errors(t), [{ message: 'guard "a" depends on itself', loc: { line: 2, column: 15 } }]);
  // the same guard used twice, side by side, is no loop
  const twice = host({}, { guards: { x: { has: 'y' } } });
  assert.deepEqual([holds({ all: [{ guard: 'x' }, { guard: 'x' }] }, twice), errors(evaluate({ all: [{ guard: 'x' }, { guard: 'x' }] }, twice))], [true, []]);
});

// ---------------------------------------------------------------------------
// Registered words
// ---------------------------------------------------------------------------

/** A toy leaf with JSON arguments: holds when the host's `entries` has one equal to its args. */
const entry: Word = {
  read: (args) => (args === null || typeof args !== 'object' || Array.isArray(args) ? 'takes properties' : undefined),
  test: (args, _body, h) => {
    const entries = h.resolve({ from: 'entries', field: 'all' }) as Json[];
    const found = entries.findIndex((l) => JSON.stringify(l) === JSON.stringify(args));
    return { holds: found >= 0, detail: { foundIn: found } };
  },
};

/** A toy word that wraps conditions and reads their traces: at least n of them hold. */
const atLeast: Word = {
  read: (args, body) => (typeof (args as Json[])?.[0] !== 'number' ? 'takes a number' : (body ?? []).length === 0 ? 'needs a body' : undefined),
  test: (args, body) => {
    const held = (body ?? []).filter((t) => t.holds).length;
    return { holds: held >= (args as number[])[0], detail: { held, of: (body ?? []).length } };
  },
};

const wordHost = (entries: Json[], data: Record<string, Record<string, unknown>> = {}) =>
  host({ entries: { all: entries }, ...data }, { words: { entry, 'at-least': atLeast }, missing: 'false' });

test('a leaf word tests its arguments against the host, and its detail lands in the trace', () => {
  const t = evaluate({ word: 'entry', args: { kind: 'memo' } }, wordHost([{ kind: 'note' }, { kind: 'memo' }]));
  assert.deepEqual([t.holds, t.detail], [true, { foundIn: 1 }]);
  assert.equal(evaluate({ word: 'entry', args: { kind: 'x' } }, wordHost([])).holds, false);
});

test('a word that wraps conditions receives the trace of every one, none skipped', () => {
  const body: Condition[] = [{ has: input('a') }, { word: 'entry', args: { kind: 'memo' } }, { has: input('b') }, { has: input('c') }];
  const c: Condition = { word: 'at-least', args: [2], body };
  const t = evaluate(c, wordHost([{ kind: 'memo' }], { input: { a: 1 } }));
  assert.deepEqual([t.holds, t.detail], [true, { held: 2, of: 4 }]);
  assert.deepEqual(t.children?.map((x) => x.holds), [true, true, false, false]);
  assert.deepEqual(t.children?.[1].detail, { foundIn: 0 });
  assert.equal(evaluate({ ...c, args: [3] }, wordHost([{ kind: 'memo' }], { input: { a: 1 } })).holds, false);
});

test('words nest with the rest of the language, and a word sees the same host', () => {
  const c: Condition = { not: { any: [{ word: 'at-least', args: [1], body: [{ guard: 'has-memo' }] }, { has: input('z') }] } };
  const h = wordHost([{ kind: 'memo' }]);
  h.guards = { 'has-memo': { word: 'entry', args: { kind: 'memo' } } };
  const t = evaluate(c, h);
  assert.equal(t.holds, false);
  assert.deepEqual(errors(t), []);
});

test('a word the host did not register is an error in the trace', () => {
  const t = evaluate({ word: 'ghost', loc: { line: 4, column: 1 } }, host({}));
  assert.deepEqual([t.holds, t.errors], [false, [{ message: 'no word named "ghost"', loc: { line: 4, column: 1 } }]]);
});

// ---------------------------------------------------------------------------
// problems
// ---------------------------------------------------------------------------

test('problems: an unknown guard, an unknown word, a word that dislikes its use, a cycle', () => {
  const guards: Host['guards'] = { a: { guard: 'b' }, b: { guard: 'a' }, uses: { guard: 'ghost' } };
  const words = { entry, 'at-least': atLeast };
  assert.deepEqual(problems({ all: [{ guard: 'a' }, { guard: 'uses' }] }, { guards, words }), ['guard "a" depends on itself', 'no guard named "ghost"']);
  assert.deepEqual(problems({ word: 'nothing' }, { words }), ['no word named "nothing"']);
  assert.deepEqual(problems({ word: 'entry', args: [1] }, { words }), ['word "entry": takes properties']);
  assert.deepEqual(problems({ word: 'at-least', args: ['x'], body: [{ word: 'zzz' }] }, { words }), ['word "at-least": takes a number', 'no word named "zzz"']);
});

test('problems: a sound condition has none, a function guard is taken as it is, and a problem is told once', () => {
  const host: Pick<Host, 'guards'> = { guards: { fn: () => true, base: { has: 'x' }, derived: { all: [{ guard: 'base' }, { guard: 'fn' }] } } };
  assert.deepEqual(problems({ any: [{ guard: 'derived' }, { guard: 'base' }] }, host), []);
  assert.deepEqual(problems({ all: [{ guard: 'nope' }, { guard: 'nope' }] }, host), ['no guard named "nope"']);
});

// ---------------------------------------------------------------------------
// Plain data
// ---------------------------------------------------------------------------

test('a condition and its trace are plain JSON: they travel, and the copy answers the same', () => {
  const c: Condition = {
    all: [
      { is: input('s', { line: 1, column: 1 }), values: ['a', input('t')] },
      { not: { guard: 'g' } },
      { word: 'at-least', args: [1], body: [{ has: input('s') }] },
    ],
  };
  const copy = JSON.parse(JSON.stringify(c)) as Condition;
  assert.deepEqual(copy, c);
  const h = host({ input: { s: 'a', t: 'b' } }, { words: { 'at-least': atLeast }, guards: { g: { has: null } } });
  const trace = evaluate(c, h);
  assert.equal(evaluate(copy, h).holds, trace.holds);
  const back = JSON.parse(JSON.stringify(trace)) as Trace;
  assert.deepEqual(back, trace);
});

test('a word that evaluates again with the same host joins the cycle check; a condition that is not one is an error, not a throw', () => {
  const words = { again: { test: (_a: unknown, _b: unknown, h: Host) => ({ holds: evaluate({ guard: 'g' }, h).holds }) } };
  const host: Host = { resolve: () => 1, missing: 'false', guards: { g: { word: 'again' } }, words };
  // The word sees the error in its own nested trace; here the loop ends and nothing holds, instead of overflowing the stack.
  assert.equal(evaluate({ guard: 'g' }, host).holds, false);
  const loose = { resolve: () => 1, missing: 'false' } as const;
  assert.match(errors(evaluate(null as never, loose))[0].message, /not null/);
  assert.match(errors(evaluate({ all: [{}] } as never, loose))[0].message, /not a condition/);
});
