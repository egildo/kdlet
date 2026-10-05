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

import type { Condition, GuardError, GuardFn, Host, Json, Loc, Operand, Ref, Trace, Word } from './model.js';

/** Listens to a check node by node. `evaluate` builds its trace from this. */
export interface Observer {
  /** A condition is about to be answered. */
  enter(condition: Condition): void;
  /** An error was found at the condition most recently entered and not yet left. */
  error(error: GuardError): void;
  /** That condition is answered. */
  leave(holds: boolean, detail?: Json): void;
  /** The trace of the node left last: what a word receives for each condition it wraps. */
  last?: Trace;
}

const describe = (ref: Ref): string => `(${ref.from})${ref.field}`;
const isRef = (operand: Operand): operand is Extract<Operand, { ref: Ref }> => typeof operand === 'object' && operand !== null;

/** A table's own entry, so nothing on `Object.prototype` counts. */
export const own = <T>(table: Record<string, T> | undefined, name: string): T | undefined => (table && Object.hasOwn(table, name) ? table[name] : undefined);

/** The guards being answered for a host, so a word that checks again with the same host joins the same cycle check. */
const active = new WeakMap<Host, string[]>();

/**
 * Answers a condition against a host. Never throws for what the condition says; a problem it finds is in `errors`,
 * and the node it was found at does not hold.
 */
export function check(condition: Condition, host: Host, observer?: Observer): { holds: boolean; errors: GuardError[] } {
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

  const step = (c: Condition): boolean => {
    // A condition may come from stored JSON: say so, rather than throw.
    if (c === null || typeof c !== 'object') return fail(`a condition is an object, not ${c === null ? 'null' : typeof c}`, {});
    if ('is' in c) {
      const left = operand(c.is);
      return left !== undefined && c.values.some((v) => {
        const right = operand(v);
        return right !== undefined && right === left;
      });
    }
    if ('has' in c) {
      const found = isRef(c.has) ? host.resolve(c.has.ref) : c.has;
      return !(found === undefined || found === null || found === '' || (Array.isArray(found) && found.length === 0));
    }
    if ('not' in c) return !run(c.not);
    if ('all' in c) return c.all.every(run);
    if ('any' in c) return c.any.some(run);
    if ('guard' in c) {
      const name = c.guard;
      if (stack.includes(name)) return fail(`guard "${name}" depends on itself`, c);
      const guard = own(host.guards, name);
      if (guard === undefined) return fail(`no guard named "${name}"`, c);
      if (typeof guard === 'function') {
        const answer: unknown = (guard as GuardFn)(host);
        if (typeof answer === 'boolean') return answer;
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
      const holds = run(x);
      return observer?.last ?? { holds, condition: x };
    });
    const result = word.test(c.args ?? null, body, host);
    detail = result.detail;
    return result.holds;
  };

  const run = (c: Condition): boolean => {
    observer?.enter(c);
    detail = undefined;
    const holds = step(c);
    const reported = detail;
    detail = undefined;
    observer?.leave(holds, reported);
    return holds;
  };

  try {
    return { holds: run(condition), errors };
  } finally {
    if (stack.length === 0) active.delete(host);
  }
}
