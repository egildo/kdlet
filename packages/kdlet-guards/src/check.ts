/**
 * A condition and a host to an answer: whether it holds, and what went wrong.
 *
 * This is the one place the semantics live. Nothing here knows what a reference
 * means or where a guard came from: the host resolves, supplies guards and
 * registers words. The check stops at the first child that settles an `all` or
 * an `any`, so a condition is never asked what an earlier one has already
 * answered. It builds no trace; `evaluate` adds one by listening through an
 * `Observer`, so a bundle that only checks does not carry the tracing.
 */

import { UNKNOWN } from './model.js';
import type { Condition, GuardError, GuardFn, Host, Json, Loc, Operand, Ref, Trace, Word } from './model.js';

/** Listens to a check node by node. `evaluate` builds its trace from this. */
export interface Observer {
  /** A condition is about to be answered. */
  enter(condition: Condition): void;
  /** An error was found at the condition most recently entered and not yet left. */
  error(error: GuardError): void;
  /** That condition is answered. `unknown` set means it did not hold because something is not yet known. */
  leave(holds: boolean, detail?: Json, unknown?: true): void;
  /** The trace of the node left last: what a word receives for each condition it wraps. */
  last?: Trace;
}

/** What a node answers inside the check: true, false, or unknown (which reaches the result as false with a flag). */
type Answer = boolean | 'unknown';

const describe = (ref: Ref): string => `(${ref.from})${ref.field}`;
export const isRef = (operand: Operand): operand is Extract<Operand, { ref: Ref }> => typeof operand === 'object' && operand !== null;

/** What a time operand is: a date is a day number, an instant is whole seconds since the epoch and the digits after the point. */
type Time = { day: number } | { sec: number; frac: string };

// RFC 3339 `full-date` and `date-time`. The pattern shapes, `dayOf` and the ranges validate; `Date.parse` is too lenient to.
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|([+-])(\d{2}):(\d{2}))$/i;

/** The day number of a real calendar date, or nothing for one that is not (`2026-02-30`). */
function dayOf(year: number, month: number, date: number): number | undefined {
  const t = new Date(0);
  t.setUTCFullYear(year, month - 1, date);
  return t.getUTCFullYear() === year && t.getUTCMonth() === month - 1 && t.getUTCDate() === date ? t.getTime() / 86400000 : undefined;
}

/** A date or an instant written as text, or nothing. An instant needs its offset; a second of 60 is a leap second and counts as the next minute's first. */
function time(value: unknown): Time | undefined {
  if (typeof value !== 'string') return undefined;
  const date = DATE.exec(value);
  if (date) {
    const day = dayOf(+date[1], +date[2], +date[3]);
    return day === undefined ? undefined : { day };
  }
  const at = INSTANT.exec(value);
  if (!at) return undefined;
  const day = dayOf(+at[1], +at[2], +at[3]);
  const [hour, minute, second, offHour, offMinute] = [at[4], at[5], at[6], at[9] ?? '0', at[10] ?? '0'].map(Number);
  if (day === undefined || hour > 23 || minute > 59 || second > 60 || offHour > 23 || offMinute > 59) return undefined;
  const offset = (offHour * 60 + offMinute) * 60 * (at[8] === '-' ? -1 : 1);
  return { sec: day * 86400 + hour * 3600 + minute * 60 + second - offset, frac: (at[7] ?? '').replace(/0+$/, '') };
}

/** Negative, zero or positive: `a` against `b` moved by `days`. Both are of one kind. */
function difference(a: Time, b: Time, days: number): number {
  if ('day' in a && 'day' in b) return a.day - (b.day + days);
  if (!('sec' in a && 'sec' in b)) return NaN;
  const width = Math.max(a.frac.length, b.frac.length);
  const x = a.frac.padEnd(width, '0');
  const y = b.frac.padEnd(width, '0');
  return a.sec - b.sec || (x < y ? -1 : x > y ? 1 : 0);
}

/** A value as it is shown in a message. */
const shown = (value: unknown): string =>
  typeof value === 'string' ? JSON.stringify(value) : Array.isArray(value) ? 'a list' : typeof value === 'object' && value !== null ? 'an object' : typeof value === 'number' || typeof value === 'boolean' || value === null ? String(value) : `a ${typeof value}`;

const ORDERING = ['before', 'after', 'less', 'more'] as const;
type Ordering = (typeof ORDERING)[number];
type Ordered = Extract<Condition, { before: unknown } | { after: unknown } | { less: unknown } | { more: unknown }>;

export const isOrdered = (c: Condition): c is Ordered => ORDERING.some((w) => w in c);

/** The word of an ordering condition, with what it was given. */
export function ordering(c: Ordered): { word: Ordering; operands: unknown; days: unknown } {
  const word = ORDERING.find((w) => w in c) as Ordering;
  return { word, operands: (c as unknown as Record<string, unknown>)[word], days: (c as { days?: unknown }).days };
}

/** What is wrong with an ordering condition that its shape alone shows, or nothing. */
export function orderingFault(word: Ordering, operands: unknown, days: unknown): string | undefined {
  if (!Array.isArray(operands) || operands.length !== 2) return `"${word}" takes two operands, the left first`;
  if (days === undefined) return undefined;
  if (word === 'less' || word === 'more') return `"${word}" takes no days; they move the dates of "before" and "after"`;
  return Number.isInteger(days) ? undefined : `"days" must be a whole number, not ${shown(days)}`;
}

/** Why a value cannot be an operand of an ordering word, or nothing. `subject` names the reference it came from. */
export function misfit(word: Ordering, value: unknown, subject?: string): string | undefined {
  const numbers = word === 'less' || word === 'more';
  if (numbers ? typeof value === 'number' && Number.isFinite(value) : time(value)) return undefined;
  return `${subject ? `${subject} (${shown(value)})` : shown(value)} is not ${numbers ? 'a number' : 'a date or an instant'}; "${word}" compares only ${numbers ? 'numbers' : 'those'}`;
}

/** A table's own entry, so nothing on `Object.prototype` counts. */
export const own = <T>(table: Record<string, T> | undefined, name: string): T | undefined => (table && Object.hasOwn(table, name) ? table[name] : undefined);

/** The guards being answered for a host, so a word that checks again with the same host joins the same cycle check. */
const active = new WeakMap<Host, string[]>();

/**
 * Answers a condition against a host. Never throws for what the condition says; a problem it finds is in `errors`,
 * and the node it was found at does not hold and is not unknown. Where the host answers `UNKNOWN` for a reference,
 * the three-valued rules of Kleene apply and a result that depends on it is `holds: false` with `unknown: true`.
 */
export function check(condition: Condition, host: Host, observer?: Observer): { holds: boolean; errors: GuardError[]; unknown?: true } {
  const stack = active.get(host) ?? [];
  active.set(host, stack);
  const errors: GuardError[] = [];
  let detail: Json | undefined;

  const fail = (message: string, at: { loc?: Loc }): false => {
    const error: GuardError = { message, ...(at.loc ? { loc: at.loc } : {}) };
    errors.push(error);
    observer?.error(error);
    return false;
  };

  const operand = (o: Operand): unknown => {
    if (!isRef(o)) return o;
    const found = host.resolve(o.ref);
    if (found === undefined && host.missing === 'error') {
      fail(`${describe(o.ref)} has no value here; ask with "has" before comparing it`, o);
    }
    return found;
  };

  const step = (c: Condition): Answer => {
    // A condition may come from stored JSON: say so, rather than throw.
    if (c === null || typeof c !== 'object') return fail(`a condition is an object, not ${c === null ? 'null' : typeof c}`, {});
    if ('is' in c) {
      const before = errors.length;
      const left = operand(c.is);
      if (left === UNKNOWN) return 'unknown';
      if (left === undefined) return false;
      let unknown = false;
      for (const v of c.values) {
        const right = operand(v);
        if (right === UNKNOWN) unknown = true;
        else if (right !== undefined && right === left) return true;
      }
      // an error at this node wins over unknown
      return unknown && errors.length === before ? 'unknown' : false;
    }
    if ('has' in c) {
      const found = isRef(c.has) ? host.resolve(c.has.ref) : c.has;
      if (found === UNKNOWN) return 'unknown';
      return !(found === undefined || found === null || found === '' || (Array.isArray(found) && found.length === 0));
    }
    if (isOrdered(c)) {
      const { word, operands, days } = ordering(c);
      const fault = orderingFault(word, operands, days);
      if (fault) return fail(fault, c);
      const [l, r] = operands as [Operand, Operand];
      // A value that does not compare makes the node false, and under `missing: 'error'` an error, at the operand when it is a reference.
      const bad = (message: string, at?: Operand): false => (host.missing === 'error' ? fail(message, at && isRef(at) && at.loc ? at : c) : false);
      const subject = (o: Operand) => (isRef(o) ? describe(o.ref) : undefined);
      const left = operand(l);
      if (left === UNKNOWN) return 'unknown';
      if (left === undefined) return false;
      const leftMisfit = misfit(word, left, subject(l));
      if (leftMisfit) return bad(leftMisfit, l);
      const right = operand(r);
      if (right === UNKNOWN) return 'unknown';
      if (right === undefined) return false;
      const rightMisfit = misfit(word, right, subject(r));
      if (rightMisfit) return bad(rightMisfit, r);
      if (word === 'less' || word === 'more') return word === 'less' ? (left as number) < (right as number) : (left as number) > (right as number);
      const a = time(left) as Time;
      const b = time(right) as Time;
      if ('day' in a !== 'day' in b) return bad(`"${word}" cannot compare a date with an instant; state both as dates or both as instants`);
      if (days !== undefined && !('day' in a)) return bad(`"days" moves dates only; "${word}" was given instants`);
      const apart = difference(a, b, typeof days === 'number' ? days : 0);
      return word === 'before' ? apart < 0 : apart > 0;
    }
    if ('not' in c) {
      const answer = run(c.not);
      return answer === 'unknown' ? answer : !answer;
    }
    if ('all' in c || 'any' in c) {
      // all: false beats unknown beats true. any: true beats unknown beats false. The first child that settles it ends the walk.
      const settles = 'all' in c ? false : true;
      let unknown = false;
      for (const child of 'all' in c ? c.all : c.any) {
        const answer = run(child);
        if (answer === settles) return settles;
        if (answer === 'unknown') unknown = true;
      }
      return unknown ? 'unknown' : !settles;
    }
    if ('guard' in c) {
      const name = c.guard;
      if (stack.includes(name)) return fail(`guard "${name}" depends on itself`, c);
      const guard = own(host.guards, name);
      if (guard === undefined) return fail(`no guard named "${name}"`, c);
      if (typeof guard === 'function') {
        const answer: unknown = (guard as GuardFn)(host);
        if (typeof answer === 'boolean' || answer === 'unknown') return answer;
        if (typeof answer === 'object' && answer !== null && typeof (answer as { error?: unknown }).error === 'string') return fail((answer as { error: string }).error, c);
        return fail(`the host's guard "${name}" returned ${typeof answer}, not true or false`, c);
      }
      stack.push(name);
      try {
        return run(guard);
      } finally {
        stack.pop();
      }
    }
    if (typeof c.word !== 'string') return fail('not a condition: it has none of is, has, not, all, any, guard or word', c);
    const word: Word | undefined = own(host.words, c.word);
    if (!word) return fail(`no word named "${c.word}"`, c);
    // A word wrapping conditions receives a trace of every one: the full trace when something listens, otherwise a bare one.
    const body = c.body?.map((x): Trace => {
      const answer = run(x);
      return observer?.last ?? { holds: answer === true, condition: x, ...(answer === 'unknown' ? { unknown: true as const } : {}) };
    });
    const result = word.test(c.args ?? null, body, host);
    detail = result.detail;
    return result.unknown ? 'unknown' : result.holds;
  };

  const run = (c: Condition): Answer => {
    observer?.enter(c);
    detail = undefined;
    const answer = step(c);
    const reported = detail;
    detail = undefined;
    observer?.leave(answer === true, reported, answer === 'unknown' ? true : undefined);
    return answer;
  };

  try {
    const answer = run(condition);
    return { holds: answer === true, errors, ...(answer === 'unknown' ? { unknown: true as const } : {}) };
  } finally {
    if (stack.length === 0) active.delete(host);
  }
}
