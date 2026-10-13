import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@bgotink/kdl';
import { UNKNOWN, check, errors, evaluate, problems } from '../src/index.js';
import type { Condition, Host, Operand, Ref } from '../src/index.js';
import { readBody, writeGuard } from '../src/kdl.js';
import type { ReadOptions } from '../src/kdl.js';

const host = (data: Record<string, unknown>, missing: Host['missing'] = 'error'): Host => ({ resolve: (ref: Ref) => data[ref.field], missing });

const item = (field: string, loc?: { line: number; column: number }): Operand => ({ ref: { from: 'item', field }, ...(loc ? { loc } : {}) });
const before = (a: Operand, b: Operand, days?: number): Condition => ({ before: [a, b], ...(days === undefined ? {} : { days }) });
const after = (a: Operand, b: Operand, days?: number): Condition => ({ after: [a, b], ...(days === undefined ? {} : { days }) });
const holds = (c: Condition, h: Host = host({})): boolean => evaluate(c, h).holds;
const messages = (c: Condition, h: Host = host({})): string[] => errors(evaluate(c, h)).map((e) => e.message);

// ---------------------------------------------------------------------------
// The four words
// ---------------------------------------------------------------------------

test('before and after: the left is earlier, or later, than the right', () => {
  assert.equal(holds(before('2026-10-12', '2026-10-13')), true);
  assert.equal(holds(before('2026-10-14', '2026-10-13')), false);
  assert.equal(holds(after('2026-10-14', '2026-10-13')), true);
  assert.equal(holds(after('2026-10-12', '2026-10-13')), false);
  const h = host({ approved: '2026-10-12', requested: '2026-10-13' });
  assert.equal(holds(before(item('approved'), item('requested')), h), true);
  assert.equal(holds(after(item('approved'), item('requested')), h), false);
});

test('less and more: the left is a smaller, or a greater, number than the right', () => {
  assert.equal(holds({ less: [1, 2] }), true);
  assert.equal(holds({ less: [2, 1] }), false);
  assert.equal(holds({ more: [2, 1] }), true);
  assert.equal(holds({ more: [1, 2] }), false);
  assert.equal(holds({ less: [-1.5, 0] }), true);
  const h = host({ n: 3, limit: 10 });
  assert.equal(holds({ less: [item('n'), item('limit')] }, h), true);
  assert.equal(holds({ more: [item('n'), item('limit')] }, h), false);
});

test('all four are strict at equality, and not gives the inclusive forms', () => {
  assert.equal(holds(before('2026-10-13', '2026-10-13')), false);
  assert.equal(holds(after('2026-10-13', '2026-10-13')), false);
  assert.equal(holds({ less: [2, 2] }), false);
  assert.equal(holds({ more: [2, 2] }), false);
  // on or before, on or after, at most, at least
  assert.equal(holds({ not: after('2026-10-13', '2026-10-13') }), true);
  assert.equal(holds({ not: before('2026-10-13', '2026-10-13') }), true);
  assert.equal(holds({ not: after('2026-10-14', '2026-10-13') }), false);
  assert.equal(holds({ not: { more: [2, 2] } }), true);
  assert.equal(holds({ not: { less: [2, 2] } }), true);
  assert.equal(holds({ not: { less: [1, 2] } }), false);
});

test('a word of ordering sits among the others, and all stops at it as at any child', () => {
  const c: Condition = { all: [{ has: item('d') }, before(item('d'), '2026-12-31')] };
  assert.equal(holds(c, host({ d: '2026-10-13' })), true);
  assert.equal(holds(c, host({})), false);
  assert.deepEqual(messages(c, host({})), []);
});

// ---------------------------------------------------------------------------
// Dates and instants
// ---------------------------------------------------------------------------

test('an instant against an instant is compared as the moment it names, whatever offset it was written with', () => {
  const noon = '2026-10-13T17:00:00Z';
  const sameMoment = '2026-10-13T19:00:00+02:00';
  assert.equal(holds(before(noon, sameMoment)), false);
  assert.equal(holds(after(noon, sameMoment)), false);
  assert.equal(holds({ not: before(noon, sameMoment) }), true);
  assert.equal(holds(before(noon, '2026-10-13T19:30:00+02:00')), true);
  assert.equal(holds(after(noon, '2026-10-13T12:00:01-05:00')), false);
  assert.equal(holds(after(noon, '2026-10-13T11:59:59-05:00')), true);
  // an offset that carries into the next or the previous day
  assert.equal(holds(before('2026-12-31T23:30:00-02:00', '2027-01-01T01:30:01Z')), true);
  assert.equal(holds(after('2026-12-31T23:30:00-02:00', '2027-01-01T01:30:00Z')), false);
  assert.equal(holds(before('2027-01-01T00:30:00+02:00', '2026-12-31T22:30:01Z')), true);
});

test('an instant counts its fractions of a second exactly, and case does not matter for T and Z', () => {
  assert.equal(holds(before('2026-10-13T17:00:00Z', '2026-10-13T17:00:00.5Z')), true);
  assert.equal(holds(before('2026-10-13T17:00:00.25Z', '2026-10-13T17:00:00.5Z')), true);
  assert.equal(holds(after('2026-10-13T17:00:00.25Z', '2026-10-13T17:00:00.5Z')), false);
  assert.equal(holds(after('2026-10-13T17:00:00.123456789012Z', '2026-10-13T17:00:00.123456789011Z')), true);
  assert.equal(holds(before('2026-10-13T17:00:00.50Z', '2026-10-13T17:00:00.5Z')), false);
  assert.equal(holds(after('2026-10-13T17:00:00.50Z', '2026-10-13T17:00:00.5Z')), false);
  assert.equal(holds(before('2026-10-13t17:00:00z', '2026-10-13T17:00:01Z')), true);
});

test('a date against an instant does not hold, in either order and under either word, and under missing: error it says why', () => {
  for (const c of [before('2026-10-13', '2026-10-14T00:00:00Z'), before('2026-10-13T00:00:00Z', '2026-10-14'), after('2026-10-15', '2026-10-14T00:00:00Z'), after('2026-10-15T00:00:00Z', '2026-10-14')]) {
    assert.equal(holds(c), false);
    assert.equal(holds({ not: c }), true);
  }
  const c = before('2026-10-13', '2026-10-14T00:00:00Z');
  assert.deepEqual(messages(c), ['"before" cannot compare a date with an instant; state both as dates or both as instants']);
  assert.deepEqual(messages(c, host({}, 'false')), []);
  // with days it is still the mismatch that is said
  assert.deepEqual(messages(before('2026-10-13', '2026-10-14T00:00:00Z', 1)), ['"before" cannot compare a date with an instant; state both as dates or both as instants']);
});

test('invalid dates and instants, and strings that only look like them, do not compare', () => {
  const bad = [
    '2026-02-30',
    '2027-02-29',
    '2026-13-01',
    '2026-00-10',
    '2026-10-00',
    '2026-04-31',
    '2026-1-1',
    '26-10-13',
    '13/10/2026',
    '20261013',
    ' 2026-10-13',
    '2026-10-13 ',
    '2026-10-13\n',
    'tomorrow',
    '',
    '2026-10-13T17:00:00',
    '2026-10-13T17:00Z',
    '2026-10-13 17:00:00Z',
    '2026-10-13T24:00:00Z',
    '2026-10-13T17:60:00Z',
    '2026-10-13T17:00:61Z',
    '2026-10-13T17:00:00+24:00',
    '2026-10-13T17:00:00+02:60',
    '2026-10-13T17:00:00+0200',
    '2026-10-13T17:00:00+02',
    '2026-02-30T17:00:00Z',
    '2026-10-13T17:00:00.Z',
  ];
  for (const text of bad) {
    assert.equal(holds(before(text, '2099-01-01')), false, text);
    assert.equal(holds(after(text, '1999-01-01')), false, text);
    assert.equal(holds(before('1999-01-01', text)), false, text);
    assert.equal(holds(after('2099-01-01T00:00:00Z', text)), false, text);
    assert.equal(holds({ not: before(text, '2099-01-01') }), true, text);
  }
  assert.deepEqual(messages(before('2026-02-30', '2026-10-13')), ['"2026-02-30" is not a date or an instant; "before" compares only those']);
  // the real ones next to them: a leap day, the end of a month, a leap second, an offset at its limits
  assert.equal(holds(before('2028-02-29', '2028-03-01')), true);
  assert.equal(holds(before('2026-04-30', '2026-05-01')), true);
  assert.equal(holds(before('2026-10-13T23:59:59Z', '2026-10-13T23:59:60Z')), true);
  assert.equal(holds(before('2026-10-13T23:59:60Z', '2026-10-14T00:00:01Z')), true);
  assert.equal(holds(before('2026-10-13T00:00:00+23:59', '2026-10-13T00:00:00Z')), true);
  assert.equal(holds(before('2026-10-13T17:00:00-00:00', '2026-10-13T17:00:01Z')), true);
  assert.equal(holds(before('0000-01-01', '9999-12-31')), true);
});

test('a value that is not text is no time', () => {
  for (const value of [20261013, true, null, {}, []]) {
    assert.equal(holds(before(item('x'), '2099-01-01'), host({ x: value })), false);
  }
  assert.deepEqual(messages(before(item('x'), '2099-01-01'), host({ x: 20261013 })), ['(item)x (20261013) is not a date or an instant; "before" compares only those']);
  assert.deepEqual(messages(before(item('x'), '2099-01-01'), host({ x: { a: 1 } })), ['(item)x (an object) is not a date or an instant; "before" compares only those']);
  assert.deepEqual(messages(before(item('x'), '2099-01-01'), host({ x: [1] })), ['(item)x (a list) is not a date or an instant; "before" compares only those']);
  assert.deepEqual(messages(before(item('x'), '2099-01-01'), host({ x: null })), ['(item)x (null) is not a date or an instant; "before" compares only those']);
});

// ---------------------------------------------------------------------------
// days
// ---------------------------------------------------------------------------

test('days moves the right date: within five days, and at least two days before', () => {
  const within = (approved: string): boolean => holds(before(item('approved'), item('requested'), 5), host({ approved, requested: '2026-10-13' }));
  assert.equal(within('2026-10-13'), true);
  assert.equal(within('2026-10-17'), true);
  assert.equal(within('2026-10-18'), false); // the fifth day after is not earlier than itself
  assert.equal(within('2026-10-12'), true);
  const early = (sent: string): boolean => holds(before(item('sent'), item('deadline'), -2), host({ sent, deadline: '2026-10-13' }));
  assert.equal(early('2026-10-10'), true);
  assert.equal(early('2026-10-11'), false);
  assert.equal(early('2026-10-12'), false);
  assert.equal(holds(after('2026-10-15', '2026-10-13', 2)), false);
  assert.equal(holds(after('2026-10-16', '2026-10-13', 2)), true);
  assert.equal(holds(before('2026-10-13', '2026-10-13', 0)), false);
  assert.equal(holds(before('2026-10-13', '2026-10-13', 1)), true);
});

test('days counts calendar days across a month end, a year end and a leap day', () => {
  assert.equal(holds(before('2026-10-31', '2026-10-28', 4)), true);
  assert.equal(holds(before('2026-11-01', '2026-10-28', 4)), false); // the 28th and four days is November 1st
  assert.equal(holds(before('2026-11-01', '2026-10-28', 5)), true);
  assert.equal(holds(before('2026-11-02', '2026-10-28', 5)), false);
  assert.equal(holds(after('2026-11-02', '2026-10-28', 4)), true);
  assert.equal(holds(after('2027-01-01', '2026-12-31', 0)), true);
  assert.equal(holds(after('2027-01-01', '2026-12-31', 1)), false);
  assert.equal(holds(after('2027-01-02', '2026-12-31', 1)), true);
  assert.equal(holds(after('2027-02-01', '2026-01-31', 365)), true);
  assert.equal(holds(after('2027-01-31', '2026-01-31', 365)), false);
  // 2028 has a February 29th, 2026 does not
  assert.equal(holds(after('2028-03-01', '2028-02-28', 1)), true);
  assert.equal(holds(after('2028-03-01', '2028-02-28', 2)), false);
  assert.equal(holds(after('2026-03-01', '2026-02-28', 1)), false);
  assert.equal(holds(after('2026-03-02', '2026-02-28', 1)), true);
  assert.equal(holds(before('2028-02-29', '2028-03-02', -2)), false);
  assert.equal(holds(before('2028-02-28', '2028-03-02', -2)), true);
  assert.equal(holds(before('2028-02-28', '2028-03-01', -1)), true);
  assert.equal(holds(before('2028-02-29', '2028-03-01', -1)), false);
  assert.equal(holds(after('2028-02-29', '2028-03-01', -2)), true);
  assert.equal(holds(after('2028-02-28', '2028-03-01', -2)), false);
});

test('days on instants does not hold, and a date against an instant is the mismatch', () => {
  const c = before('2026-10-13T00:00:00Z', '2026-10-14T00:00:00Z', 1);
  assert.equal(holds(c), false);
  assert.equal(holds({ not: c }), true);
  assert.deepEqual(messages(c), ['"days" moves dates only; "before" was given instants']);
  assert.deepEqual(messages(after('2026-10-15T00:00:00Z', '2026-10-14T00:00:00Z', 0)), ['"days" moves dates only; "after" was given instants']);
  assert.deepEqual(messages(c, host({}, 'false')), []);
  // without days the same instants compare
  assert.equal(holds(before('2026-10-13T00:00:00Z', '2026-10-14T00:00:00Z')), true);
});

// ---------------------------------------------------------------------------
// What does not compare
// ---------------------------------------------------------------------------

test('"7" against 7: text is not a number, and a number is not a time', () => {
  assert.equal(holds({ less: ['7', 10] }), false);
  assert.equal(holds({ less: [7, '10'] }), false);
  assert.equal(holds({ more: ['7', '6'] }), false);
  assert.equal(holds({ more: [item('n'), 6] }, host({ n: '7' })), false);
  assert.equal(holds({ more: [item('n'), 6] }, host({ n: 7 })), true);
  assert.deepEqual(messages({ less: [item('n'), 10] }, host({ n: '7' })), ['(item)n ("7") is not a number; "less" compares only numbers']);
  assert.deepEqual(messages({ more: [7, '6'] }), ['"6" is not a number; "more" compares only numbers']);
  for (const value of [NaN, Infinity, -Infinity, true, null, '2026-10-13']) {
    assert.equal(holds({ less: [value as number, 10] }), false, String(value));
    assert.equal(holds({ not: { less: [value as number, 10] } }), true, String(value));
    assert.equal(holds({ more: [10, value as number] }), false, String(value));
  }
  assert.equal(holds(before(7, 9)), false);
  assert.deepEqual(messages(before(7, 9)), ['7 is not a date or an instant; "before" compares only those']);
});

test("a value that does not compare is an error under missing: 'error', at the operand's place, and nothing under 'false'", () => {
  const c: Condition = { less: [item('n', { line: 2, column: 7 }), item('m', { line: 2, column: 15 })] };
  const t = evaluate(c, host({ n: 1, m: 'x' }));
  assert.equal(t.holds, false);
  assert.deepEqual(t.errors, [{ message: '(item)m ("x") is not a number; "less" compares only numbers', loc: { line: 2, column: 15 } }]);
  assert.deepEqual(errors(evaluate(c, host({ n: 'x', m: 1 })))[0].loc, { line: 2, column: 7 });
  assert.deepEqual(errors(evaluate(c, host({ n: 'x', m: 1 }, 'false'))), []);
  assert.equal(evaluate(c, host({ n: 'x', m: 1 }, 'false')).holds, false);
  // a literal has no place of its own: the condition's is used
  const lit = evaluate({ less: [1, 'x'], loc: { line: 5, column: 1 } }, host({}));
  assert.deepEqual(lit.errors?.[0].loc, { line: 5, column: 1 });
});

test('a left of the wrong kind is said at once; the right is not asked', () => {
  const t = evaluate(before(item('a'), item('b')), host({ a: 'soon' }));
  assert.deepEqual(
    t.errors?.map((e) => e.message),
    ['(item)a ("soon") is not a date or an instant; "before" compares only those'],
  );
});

test('a condition whose shape is wrong is an error under both modes: two operands, whole days, no days on numbers', () => {
  const loose = (c: unknown, missing: Host['missing']): string[] => messages(c as Condition, host({}, missing));
  for (const missing of ['error', 'false'] as const) {
    assert.deepEqual(loose({ before: ['2026-10-13'] }, missing), ['"before" takes two operands, the left first']);
    assert.deepEqual(loose({ less: [1, 2, 3] }, missing), ['"less" takes two operands, the left first']);
    assert.deepEqual(loose({ more: 1 }, missing), ['"more" takes two operands, the left first']);
    assert.deepEqual(loose(before('2026-10-13', '2026-10-14', 1.5), missing), ['"days" must be a whole number, not 1.5']);
    assert.deepEqual(loose({ after: ['2026-10-13', '2026-10-14'], days: '2' }, missing), ['"days" must be a whole number, not "2"']);
    assert.deepEqual(loose({ after: ['2026-10-13', '2026-10-14'], days: null }, missing), ['"days" must be a whole number, not null']);
    assert.deepEqual(loose({ less: [1, 2], days: 1 }, missing), ['"less" takes no days; they move the dates of "before" and "after"']);
    assert.equal(check({ less: [1, 2], days: 1 } as never, host({}, missing)).holds, false);
  }
});

// ---------------------------------------------------------------------------
// Absent and unknown
// ---------------------------------------------------------------------------

test("an absent operand is false, and an error where it stands under missing: 'error', as for is", () => {
  const right = { line: 1, column: 30 };
  for (const c of [before(item('a'), item('b', right)), after(item('a'), item('b', right)), { less: [item('a'), item('b', right)] }, { more: [item('a'), item('b', right)] }] as Condition[]) {
    const word = Object.keys(c)[0];
    const given = word === 'less' || word === 'more' ? { a: 1 } : { a: '2026-10-13' };
    const t = evaluate(c, host(given));
    assert.equal(t.holds, false);
    assert.equal(t.unknown, undefined);
    assert.deepEqual(t.errors, [{ message: '(item)b has no value here; ask with "has" before comparing it', loc: right }]);
    assert.deepEqual(errors(evaluate(c, host(given, 'false'))), []);
    assert.equal(holds(c, host(given, 'false')), false);
    // the left alone when it is absent: the right is not asked
    assert.deepEqual(messages(c, host({})), ['(item)a has no value here; ask with "has" before comparing it']);
    assert.deepEqual(messages(c, host({}, 'false')), []);
    // not turns the absence into true, with the error kept
    assert.equal(holds({ not: c }, host({})), true);
  }
});

test('has asks about absence before an ordering word compares', () => {
  const c: Condition = { all: [{ has: item('d') }, after(item('d'), '2026-01-01')] };
  assert.deepEqual([holds(c, host({})), messages(c, host({}))], [false, []]);
  assert.equal(holds(c, host({ d: '2026-02-01' })), true);
});

test('UNKNOWN on either side makes the node unknown: false with the flag, by the tables of is', () => {
  const unknown = { u: UNKNOWN, d: '2026-10-13', n: 4, junk: 'x' };
  for (const c of [
    before(item('u'), item('d')),
    before(item('d'), item('u')),
    after(item('u'), '2026-10-13'),
    after('2026-10-13', item('u')),
    { less: [item('u'), item('n')] },
    { less: [item('n'), item('u')] },
    { more: [item('u'), 3] },
    { more: [3, item('u')] },
    before(item('u'), item('u')),
  ] as Condition[]) {
    const result = check(c, host(unknown));
    assert.deepEqual([result.holds, result.unknown, result.errors], [false, true, []], JSON.stringify(c));
    const t = evaluate(c, host(unknown));
    assert.deepEqual([t.holds, t.unknown], [false, true]);
    const negated = evaluate({ not: c }, host(unknown));
    assert.deepEqual([negated.holds, negated.unknown], [false, true]);
  }
  // unknown beside a certainty: all gives way to a false, any to a true
  const u = before(item('u'), item('d'));
  assert.deepEqual(check({ all: [u, { less: [2, 1] }] }, host(unknown)), { holds: false, errors: [] });
  assert.deepEqual(check({ any: [u, { less: [1, 2] }] }, host(unknown)), { holds: true, errors: [] });
  assert.deepEqual(check({ any: [u, { less: [2, 1] }] }, host(unknown)), { holds: false, errors: [], unknown: true });
});

test('an unknown left is unknown whatever the right is; an unknown right beside a left that cannot compare is the error', () => {
  const data = { u: UNKNOWN, junk: 'x', gone: undefined };
  assert.equal(check({ less: [item('u'), item('gone')] }, host(data, 'false')).unknown, true);
  assert.equal(check({ less: [item('u'), 'x'] }, host(data)).unknown, true);
  // an unknown right: the left is a text where a number is due, which is an error and false, not unknown
  const wrong = check({ less: [item('junk'), item('u')] }, host(data));
  assert.deepEqual([wrong.holds, wrong.unknown, wrong.errors.length], [false, undefined, 1]);
  // a left that compares, an unknown right: unknown, no error
  assert.equal(check({ less: [1, item('u')] }, host(data)).unknown, true);
  // an absent right with an unknown left is not asked at all
  assert.deepEqual(check({ less: [item('u'), item('gone')] }, host(data)).errors, []);
});

test('the trace of an ordering node is the trace of an is node: holds, unknown, condition and errors, no children', () => {
  const c = before(item('a'), item('b'));
  const t = evaluate(c, host({ a: '2026-10-12', b: '2026-10-13' }));
  assert.deepEqual(Object.keys(t).sort(), ['condition', 'holds']);
  assert.equal(t.condition, c);
  const u = evaluate(c, host({ a: UNKNOWN, b: '2026-10-13' }));
  assert.deepEqual(Object.keys(u).sort(), ['condition', 'holds', 'unknown']);
  const e = evaluate(c, host({ a: 'x', b: '2026-10-13' }));
  assert.deepEqual(Object.keys(e).sort(), ['condition', 'errors', 'holds']);
  const tree = evaluate({ all: [c, { less: [1, 2] }] }, host({ a: '2026-10-12', b: '2026-10-13' }));
  assert.deepEqual(tree.children?.map((x) => x.holds), [true, true]);
  // the trace is plain JSON
  assert.deepEqual(JSON.parse(JSON.stringify(tree)), tree);
});

// ---------------------------------------------------------------------------
// problems
// ---------------------------------------------------------------------------

test('problems: what is visible without values, each once', () => {
  const none = { guards: {}, words: {} };
  const found = (c: unknown): string[] => problems(c as Condition, none);
  assert.deepEqual(found({ before: ['2026-10-13'] }), ['"before" takes two operands, the left first']);
  assert.deepEqual(found({ after: ['2026-10-13', '2026-10-14', '2026-10-15'] }), ['"after" takes two operands, the left first']);
  assert.deepEqual(found({ less: 5 }), ['"less" takes two operands, the left first']);
  assert.deepEqual(found(before('soon', '2026-10-13')), ['"soon" is not a date or an instant; "before" compares only those']);
  assert.deepEqual(found(after('2026-10-13', 7)), ['7 is not a date or an instant; "after" compares only those']);
  assert.deepEqual(found(before('soon', 'later')), ['"soon" is not a date or an instant; "before" compares only those', '"later" is not a date or an instant; "before" compares only those']);
  assert.deepEqual(found(before('2026-02-30', '2026-10-13')), ['"2026-02-30" is not a date or an instant; "before" compares only those']);
  assert.deepEqual(found({ less: ['7', 9] }), ['"7" is not a number; "less" compares only numbers']);
  assert.deepEqual(found({ more: [item('n'), true] }), ['true is not a number; "more" compares only numbers']);
  assert.deepEqual(found({ more: [2, '2026-10-13'] }), ['"2026-10-13" is not a number; "more" compares only numbers']);
  assert.deepEqual(found(before('2026-10-13', '2026-10-14', 1.5)), ['"days" must be a whole number, not 1.5']);
  assert.deepEqual(found({ before: ['2026-10-13', '2026-10-14'], days: '2' }), ['"days" must be a whole number, not "2"']);
  assert.deepEqual(found({ less: [1, 2], days: 1 }), ['"less" takes no days; they move the dates of "before" and "after"']);
  assert.deepEqual(found({ more: [1, 2], days: 'x' }), ['"more" takes no days; they move the dates of "before" and "after"']);
  assert.deepEqual(found({ all: [{ less: [1] }, { not: { less: [1] } }] }), ['"less" takes two operands, the left first']);
  // a reference is not looked at: its value is the host's
  assert.deepEqual(found(before(item('a'), item('b'), 3)), []);
  assert.deepEqual(found(before('2026-10-13T17:00:00+02:00', '2026-10-14T00:00:00Z')), []);
  assert.deepEqual(found({ less: [-1, 2.5] }), []);
});

// ---------------------------------------------------------------------------
// KDL
// ---------------------------------------------------------------------------

const nodesOf = (text: string) => parse(text, { storeLocations: true }).nodes;
const read = (text: string, options: ReadOptions = {}) => {
  const { conditions, problems: found } = readBody(nodesOf(text), options);
  return { conditions, lines: found.map((p) => `${p.line}:${p.column} ${p.message}`) };
};
const bare = (c: unknown): unknown => JSON.parse(JSON.stringify(c, (key, value) => (key === 'loc' ? undefined : value)));

test('the four are nodes: two arguments, the left first, a reference as is reads one, and days a property', () => {
  const { conditions, lines } = read('before (item)approved (item)requested days=5\nafter (item)sent "2026-10-13"\nless (item)n 10\nmore (item)n (input)limit');
  assert.deepEqual(lines, []);
  assert.deepEqual(conditions, [
    {
      before: [
        { ref: { from: 'item', field: 'approved' }, loc: { line: 1, column: 8 } },
        { ref: { from: 'item', field: 'requested' }, loc: { line: 1, column: 23 } },
      ],
      days: 5,
      loc: { line: 1, column: 1 },
    },
    { after: [{ ref: { from: 'item', field: 'sent' }, loc: { line: 2, column: 7 } }, '2026-10-13'], loc: { line: 2, column: 1 } },
    { less: [{ ref: { from: 'item', field: 'n' }, loc: { line: 3, column: 6 } }, 10], loc: { line: 3, column: 1 } },
    { more: [{ ref: { from: 'item', field: 'n' }, loc: { line: 4, column: 6 } }, { ref: { from: 'input', field: 'limit' }, loc: { line: 4, column: 14 } }], loc: { line: 4, column: 1 } },
  ]);
  assert.deepEqual(bare(read('before (item)a "2026-10-13T17:00:00+02:00" days=-2').conditions), [{ before: [{ ref: { from: 'item', field: 'a' } }, '2026-10-13T17:00:00+02:00'], days: -2 }]);
});

test('read, write and read again give the same condition, with references and days', () => {
  const texts = [
    'before (item)approved (item)requested days=5',
    'before (item)sent (item)deadline days=-2',
    'after (item)a (item)b',
    'after (item)at "2026-10-13T19:00:00+02:00"',
    'before (input)d "2026-12-31" days=0',
    'less (item)n 10',
    'more (item)n -1.5',
    'less (item)n (input)limit',
    'all {\n    has (item)d\n    before (item)d (input)deadline days=3\n    not {\n        more (item)n 7\n    }\n}',
    'any {\n    less (item)a (item)b\n    after (item)c (item)d days=1\n}',
  ];
  for (const text of texts) {
    const first = read(text);
    assert.deepEqual(first.lines, [], text);
    assert.equal(writeGuard(first.conditions[0]), text);
    const second = read(writeGuard(first.conditions[0]));
    assert.deepEqual(bare(second.conditions), bare(first.conditions), text);
  }
  const built: Condition = before(item('approved'), item('requested'), 5);
  assert.equal(writeGuard(built), 'before (item)approved (item)requested days=5');
  assert.equal(writeGuard({ less: [1, 2] }), 'less 1 2');
});

test('a read ordering condition is evaluated, and its errors point back into the text', () => {
  const { conditions } = read('before (item)approved (item)requested days=5');
  const t = evaluate(conditions[0], host({ approved: '2026-10-17', requested: '2026-10-13' }));
  assert.equal(t.holds, true);
  const bad = evaluate(conditions[0], host({ approved: 'soon', requested: '2026-10-13' }));
  assert.deepEqual(bad.errors?.[0].loc, { line: 1, column: 8 });
});

function refused(text: string, expected: string[], options: ReadOptions = {}): void {
  const { conditions, lines } = read(text, options);
  assert.deepEqual(lines, expected, text);
  assert.deepEqual(conditions, [], `${text}: a condition with a fault is left out whole`);
}

test('malformed ordering nodes are reported where they are, and left out whole', () => {
  refused('before (item)a', ['1:1 "before" takes two operands, the left first']);
  refused('before', ['1:1 "before" takes two operands, the left first']);
  refused('less (item)a 1 2', ['1:1 "less" takes two operands, the left first']);
  refused('before "2026-10-13" (item)b', ['1:8 "before" starts with a reference such as (input)name or (item)field, not "2026-10-13"']);
  refused('more (item)a.b 1', ['1:6 (item)"a.b": a reference names a single field; paths are not part of the language']);
  refused('less (item)a (item)""', ['1:14 (item)"": a reference names a field with text']);
  refused('before (item)a (item)b days=1.5', ['1:24 "days" must be a whole number, not 1.5']);
  refused('before (item)a (item)b days="5"', ['1:24 "days" must be a whole number, not "5"']);
  refused('after (item)a (item)b days=(x)5', ['1:23 "days" takes a plain number; the tag on (x)5 means nothing here']);
  refused('less (item)a 1 days=2', ['1:16 "less" takes no days; they move the dates of "before" and "after"']);
  refused('more (item)a 1 days=2', ['1:16 "more" takes no days; they move the dates of "before" and "after"']);
  refused('before (item)a 1 days=1.5 days=2', ['1:27 "days" is written twice on before; KDL would keep only the last', '1:18 "days" must be a whole number, not 1.5']);
  // several faults in one run, in order
  refused('before (item)a days=1.5\nless 1 2', ['1:1 "before" takes two operands, the left first', '1:16 "days" must be a whole number, not 1.5', '2:6 "less" starts with a reference such as (input)name or (item)field, not 1']);
});

test('what is only extra on an ordering node is reported and the condition is still read', () => {
  const properties = read('before (item)a (item)b other=1');
  assert.deepEqual(properties.lines, ['1:24 before takes no properties']);
  assert.equal(properties.conditions.length, 1);
  const withBody = read('less (item)a 1 {\n    has (item)a\n}');
  assert.deepEqual(withBody.lines, ['2:5 less takes no body']);
  assert.equal(withBody.conditions.length, 1);
});

test('a tag that is not a reference is refused where it stands, as in is', () => {
  const isReference = (tag: string) => tag === 'item';
  assert.deepEqual(read('before (item)a (literal)5', { isReference }).lines, ['1:16 "before" compares plain values and references, not (literal) values']);
  assert.deepEqual(read('less (input)a 1', { isReference }).lines, ['1:6 "less" starts with a reference such as (input)name or (item)field, not (input)"a"']);
});

test('under a host that keeps names under not, the ordering words are no words of a guard\'s body', () => {
  const strict: ReadOptions = { guardNames: 'under-not' };
  for (const word of ['before', 'after', 'less', 'more']) {
    const { conditions, lines } = read(`${word} (item)a (item)b`, strict);
    assert.deepEqual(conditions, [], word);
    assert.deepEqual(lines, [`1:1 a guard's body takes is, has, not, all and any, not "${word}"`], word);
  }
});
