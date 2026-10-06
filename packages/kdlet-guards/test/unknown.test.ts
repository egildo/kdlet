import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UNKNOWN, check, errors, evaluate } from '../src/index.js';
import type { Condition, Host, Json, Trace } from '../src/index.js';

const ref = (field: string) => ({ ref: { from: 'input', field } });
const data: Record<string, unknown> = { kind: 'featured', u: UNKNOWN, v: UNKNOWN };

const T: Condition = { has: 'x' };
const F: Condition = { has: null };
const U: Condition = { has: ref('u') };
const ghost: Condition = { guard: 'ghost' };

const host = (missing: 'error' | 'false', extra: Partial<Host> = {}): Host => ({
  resolve: (r) => data[r.field],
  missing,
  guards: {
    unsure: U,
    sure: T,
    maybe: () => 'unknown',
    yes: () => true,
    odd: (() => 'perhaps') as never,
  },
  words: {
    // a leaf that cannot tell
    undecided: { test: () => ({ holds: false, unknown: true }) },
    // a word that wraps conditions and says whether they could all still hold
    possible: { test: (_: Json, body?: Trace[]) => ({ holds: (body ?? []).every((t) => t.holds || t.unknown), detail: (body ?? []).map((t) => (t.unknown ? 'u' : t.holds ? 't' : 'f')) }) },
    // a word that wraps conditions and holds only when all of them do
    sure: { test: (_: Json, body?: Trace[]) => ({ holds: (body ?? []).every((t) => t.holds) }) },
  },
  ...extra,
});

type Answer = 'true' | 'false' | 'unknown';
const read = (r: { holds: boolean; unknown?: true }): Answer => (r.unknown ? 'unknown' : r.holds ? 'true' : 'false');

// [name, condition, answer, how many errors, missing]
const TABLE: [string, Condition, Answer, number?, ('error' | 'false')?][] = [
  // is
  ['is: left unknown', { is: ref('u'), values: ['a'] }, 'unknown'],
  ['is: left unknown, a right equal to nothing known', { is: ref('u'), values: [ref('kind'), ref('v')] }, 'unknown'],
  ['is: left known, a right equal', { is: ref('kind'), values: ['featured'] }, 'true'],
  ['is: left known, a right equal beside one unknown', { is: ref('kind'), values: [ref('u'), 'featured'] }, 'true'],
  ['is: left known, none equal, one right unknown', { is: ref('kind'), values: ['standard', ref('u')] }, 'unknown'],
  ['is: left known, none equal, none unknown', { is: ref('kind'), values: ['standard'] }, 'false'],
  ['is: absent left stays false', { is: ref('ghost'), values: ['a'] }, 'false'],
  ['is: absent left, a right unknown, stays false', { is: ref('ghost'), values: [ref('u')] }, 'false'],
  ['is: absent right and an unknown right, missing false', { is: ref('kind'), values: [ref('ghost'), ref('u')] }, 'unknown'],
  ['is: absent right, missing error, is an error and false', { is: ref('kind'), values: [ref('ghost')] }, 'false', 1, 'error'],
  ['is: an error beside an unknown right, the error wins', { is: ref('kind'), values: [ref('ghost'), ref('u')] }, 'false', 1, 'error'],
  // has
  ['has: unknown', U, 'unknown'],
  ['has: known', T, 'true'],
  // not
  ['not: of true', { not: T }, 'false'],
  ['not: of false', { not: F }, 'true'],
  ['not: of unknown stays unknown', { not: U }, 'unknown'],
  ['not: twice over unknown', { not: { not: U } }, 'unknown'],
  // all
  ['all: of nothing', { all: [] }, 'true'],
  ['all: true, true', { all: [T, T] }, 'true'],
  ['all: true, unknown', { all: [T, U] }, 'unknown'],
  ['all: unknown, true', { all: [U, T] }, 'unknown'],
  ['all: unknown, false is false', { all: [U, F] }, 'false'],
  ['all: false, unknown is false', { all: [F, U] }, 'false'],
  // any
  ['any: of nothing', { any: [] }, 'false'],
  ['any: false, false', { any: [F, F] }, 'false'],
  ['any: false, unknown', { any: [F, U] }, 'unknown'],
  ['any: unknown, false', { any: [U, F] }, 'unknown'],
  ['any: unknown, true is true', { any: [U, T] }, 'true'],
  ['any: true, unknown is true', { any: [T, U] }, 'true'],
  // guard
  ['guard: as its body, unknown', { guard: 'unsure' }, 'unknown'],
  ['guard: as its body, true', { guard: 'sure' }, 'true'],
  ['guard: a function answering unknown', { guard: 'maybe' }, 'unknown'],
  ['guard: a function answering true', { guard: 'yes' }, 'true'],
  ['guard: not of a function answering unknown', { not: { guard: 'maybe' } }, 'unknown'],
  ['guard: a function answering something else is still an error', { guard: 'odd' }, 'false', 1],
  // words
  ['word: a leaf that cannot tell', { word: 'undecided' }, 'unknown'],
  ['word: a body with an unknown child, as the word decides (could still hold)', { word: 'possible', body: [T, U] }, 'true'],
  ['word: a body with an unknown child, as the word decides (does not hold)', { word: 'sure', body: [T, U] }, 'false'],
  ['word: not of a word that cannot tell', { not: { word: 'undecided' } }, 'unknown'],
  // an error beside an unknown: the node with the error is false, and the walk goes on by the tables
  ['errors: all of unknown and an error is false', { all: [U, ghost] }, 'false', 1],
  ['errors: all of an error and unknown is false', { all: [ghost, U] }, 'false', 1],
  ['errors: any of unknown and an error stays unknown, the error is kept', { any: [U, ghost] }, 'unknown', 1],
  ['errors: an unknown guard name is no unknown', { guard: 'ghost' }, 'false', 1],
  ['errors: a word nobody registered', { word: 'nobody' }, 'false', 1],
];

test('the three answers, by the tables: check and evaluate agree on every row', () => {
  for (const [name, condition, expected, count = 0, missing = 'false'] of TABLE) {
    const lean = check(condition, host(missing));
    const trace = evaluate(condition, host(missing));
    assert.equal(read(lean), expected, `${name}: check`);
    assert.equal(read(trace), expected, `${name}: evaluate`);
    assert.equal(lean.errors.length, count, `${name}: errors`);
    assert.deepEqual(errors(trace), lean.errors, `${name}: same errors`);
    // unknown is false with a flag, never true, and the flag is there only when it is set
    for (const r of [lean, trace]) assert.equal(r.unknown ? r.holds : false, false, `${name}: unknown does not hold`);
    assert.equal('unknown' in lean, expected === 'unknown', `${name}: the flag`);
  }
});

test('a consumer that reads only holds sees unknown as false', () => {
  assert.equal(check(U, host('false')).holds, false);
  assert.equal(check({ not: U }, host('false')).holds, false);
  assert.equal(evaluate({ all: [T, U] }, host('false')).holds, false);
});

test('the trace says unknown node by node, and the error stays where it was found', () => {
  const t = evaluate({ any: [{ not: U }, F, { all: [T, ghost] }] }, host('false'));
  assert.deepEqual([t.holds, t.unknown], [false, true]);
  assert.deepEqual(t.children?.map(read), ['unknown', 'false', 'false']);
  assert.deepEqual(t.children?.[0].children?.map(read), ['unknown']);
  assert.equal(t.children?.[2].children?.[1].unknown, undefined);
  assert.equal(errors(t).length, 1);
  assert.equal(JSON.stringify(t).includes('"unknown":true'), true);
  assert.deepEqual(JSON.parse(JSON.stringify(t)), t);
});

test('all stops at the first false child, any at the first true one, and an unknown child does not stop the walk', () => {
  const asked: string[] = [];
  const spy = (name: string, answer: boolean | 'unknown') => (): boolean | 'unknown' => (asked.push(name), answer);
  const h = host('false', { guards: { f: spy('f', false), t: spy('t', true), u: spy('u', 'unknown') } });
  const run = (c: Condition) => {
    asked.length = 0;
    const trace = evaluate(c, h);
    const walked = [...asked];
    asked.length = 0;
    const lean = check(c, h);
    assert.deepEqual([read(lean), asked], [read(trace), walked], 'check and evaluate walk alike');
    return [read(trace), walked, trace.children?.length];
  };
  const g = (name: string): Condition => ({ guard: name });
  assert.deepEqual(run({ all: [g('u'), g('t'), g('f'), g('t')] }), ['false', ['u', 't', 'f'], 3]);
  assert.deepEqual(run({ all: [g('f'), g('u')] }), ['false', ['f'], 1]);
  assert.deepEqual(run({ all: [g('u'), g('t')] }), ['unknown', ['u', 't'], 2]);
  assert.deepEqual(run({ any: [g('u'), g('f'), g('t'), g('f')] }), ['true', ['u', 'f', 't'], 3]);
  assert.deepEqual(run({ any: [g('t'), g('u')] }), ['true', ['t'], 1]);
  assert.deepEqual(run({ any: [g('u'), g('f')] }), ['unknown', ['u', 'f'], 2]);
});

test('a word that wraps conditions receives each child with unknown where it applies, under check and under evaluate', () => {
  const seen: Trace[][] = [];
  const spy = host('false', { words: { spy: { test: (_a, body) => (seen.push(body ?? []), { holds: true }) } } });
  const body: Condition[] = [T, U, F, { not: U }];
  evaluate({ word: 'spy', body }, spy);
  check({ word: 'spy', body }, spy);
  for (const got of seen) {
    assert.deepEqual(got.map(read), ['true', 'unknown', 'false', 'unknown']);
    assert.deepEqual(got.map((t) => 'unknown' in t), [false, true, false, true]);
  }
  // a word that decides from the children
  assert.deepEqual(evaluate({ word: 'possible', body: [T, U, F] }, host('false')).detail, ['t', 'u', 'f']);
});

test('UNKNOWN is a symbol the module exports, and `undefined` still means absent', () => {
  assert.equal(typeof UNKNOWN, 'symbol');
  assert.equal(read(check({ has: ref('ghost') }, host('false'))), 'false');
  assert.equal(read(check({ not: { has: ref('ghost') } }, host('false'))), 'true');
});
