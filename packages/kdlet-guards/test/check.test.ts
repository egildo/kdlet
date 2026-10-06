import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { check, errors, evaluate } from '../src/index.js';
import type { Condition, Host, Json } from '../src/index.js';

const ref = (field: string) => ({ ref: { from: 'input', field }, loc: { line: 1, column: field.length } });
const data: Record<string, unknown> = { kind: 'featured', n: 0, none: null, list: [], text: '', yes: true };

const words = {
  leaf: { test: (args: Json) => ({ holds: args === true, detail: 'seen' }) },
  wrap: { test: (_: Json, body?: { holds: boolean }[]) => ({ holds: (body ?? []).every((t) => t.holds) }) },
};

const host = (missing: 'error' | 'false', extra: Partial<Host> = {}): Host => ({
  resolve: (r) => data[r.field],
  missing,
  words,
  guards: {
    featured: { is: ref('kind'), values: ['featured'] },
    loop: { guard: 'loop' },
    code: () => true,
    broken: () => ({ error: 'it broke' }),
    odd: (() => 7) as never,
  },
  ...extra,
});

// One table, two evaluators: `evaluate` is `check` plus a listener, so they must never answer differently.
const CASES: [string, Condition][] = [
  ['is, equal', { is: ref('kind'), values: ['standard', 'featured'] }],
  ['is, different', { is: ref('kind'), values: ['standard'] }],
  ['is, absent left', { is: ref('ghost'), values: [ref('kind')] }],
  ['is, absent right', { is: ref('kind'), values: [ref('ghost'), 'featured'] }],
  ['is, null is a value', { is: ref('none'), values: [null] }],
  ['has, zero', { has: ref('n') }],
  ['has, null, empty list, empty text', { all: [{ has: ref('none') }, { has: ref('list') }, { has: ref('text') }] }],
  ['not', { not: { has: ref('ghost') } }],
  ['all stops at the first failure', { all: [{ has: ref('kind') }, { guard: 'ghost' }, { guard: 'ghost2' }] }],
  ['any stops at the first success', { any: [{ guard: 'nope' }, { has: ref('kind') }, { guard: 'nope2' }] }],
  ['all of nothing, any of nothing', { all: [{ all: [] }, { any: [] }] }],
  ['named guard', { guard: 'featured' }],
  ['guard by code', { guard: 'code' }],
  ['guard by code that says why not', { guard: 'broken' }],
  ['guard by code that answers wrongly', { guard: 'odd' }],
  ['unknown guard', { guard: 'ghost' }],
  ['a guard that depends on itself', { guard: 'loop' }],
  ['a leaf word', { word: 'leaf', args: true }],
  ['a word wrapping conditions', { word: 'wrap', body: [{ guard: 'featured' }, { not: { has: ref('ghost') } }] }],
  ['a word nobody registered', { word: 'nobody' }],
  ['not a condition', null as never],
  ['a shapeless condition', {} as never],
];

for (const missing of ['error', 'false'] as const) {
  test(`check and evaluate answer alike under missing: '${missing}'`, () => {
    for (const [name, condition] of CASES) {
      const traced = evaluate(condition, host(missing));
      const lean = check(condition, host(missing));
      assert.equal(lean.holds, traced.holds, `${name}: holds`);
      assert.deepEqual(lean.errors, errors(traced), `${name}: errors`);
    }
  });
}

test('check builds no trace, and a word then gets a bare trace of each condition it wraps', () => {
  let seen: unknown;
  const spy = host('false', { words: { spy: { test: (_a, body) => ((seen = body), { holds: true }) } } });
  const inner: Condition = { guard: 'featured' };
  check({ word: 'spy', body: [inner] }, spy);
  assert.deepEqual(seen, [{ holds: true, condition: inner }]);
});

test('a word that checks again with the same host joins the cycle check', () => {
  const again = host('false', { guards: { g: { word: 'again' } }, words: { again: { test: (_a, _b, h) => ({ holds: check({ guard: 'g' }, h).holds }) } } });
  assert.equal(check({ guard: 'g' }, again).holds, false);
});

// A host that never answers UNKNOWN gets what it got before the unknown was added: the same table, the same
// answers, errors and traces, recorded from the module as it stood then, and no `unknown` anywhere.
test('a host that never says unknown gets exactly the results it got before', () => {
  const shape = (condition: Condition, missing: 'error' | 'false') => {
    const keep = (key: string, value: unknown) => (key === 'condition' ? undefined : value);
    return JSON.parse(JSON.stringify({ check: check(condition, host(missing)), trace: evaluate(condition, host(missing)) }, keep));
  };
  const now = Object.fromEntries(
    (['error', 'false'] as const).map((missing) => [missing, Object.fromEntries(CASES.map(([name, condition]) => [name, shape(condition, missing)]))]),
  );
  const file = new URL('./results-before-unknown.json', import.meta.url);
  assert.deepEqual(now, JSON.parse(readFileSync(file, 'utf8')));
  assert.equal(JSON.stringify(now).includes('"unknown":'), false);
});
