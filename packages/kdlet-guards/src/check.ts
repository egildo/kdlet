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
const isRef = (operand: Operand): operand is Extract<Operand, { ref: Ref }> => typeof operand === 'object' && operand !== null;

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
