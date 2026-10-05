/**
 * A condition and a host to a trace.
 *
 * Nothing here knows what a reference means or where a guard came from: the
 * host resolves, supplies guards and registers words. The evaluator stops at
 * the first child that settles an `all` or an `any`, so a condition is never
 * asked what an earlier one has already answered.
 */

import type { Condition, GuardError, GuardFn, Host, Json, Operand, Ref, Trace, Word } from './model.js';

const describe = (ref: Ref): string => `(${ref.from})${ref.field}`;
const isRef = (operand: Operand): operand is Extract<Operand, { ref: Ref }> => typeof operand === 'object' && operand !== null;
const own = <T>(table: Record<string, T> | undefined, name: string): T | undefined => (table && Object.hasOwn(table, name) ? table[name] : undefined);

function trace(condition: Condition, holds: boolean, more: { children?: Trace[]; detail?: Json; errors?: GuardError[] } = {}): Trace {
  const out: Trace = { holds, condition };
  if (more.children && more.children.length > 0) out.children = more.children;
  if (more.detail !== undefined) out.detail = more.detail;
  if (more.errors && more.errors.length > 0) out.errors = more.errors;
  return out;
}

const failed = (condition: Condition, message: string): Trace => trace(condition, false, { errors: [{ message, ...(condition.loc ? { loc: condition.loc } : {}) }] });

function run(c: Condition, host: Host, stack: string[]): Trace {
  // A condition may come from stored JSON: say so, rather than throw.
  if (c === null || typeof c !== 'object') return { holds: false, condition: c, errors: [{ message: `a condition is an object, not ${c === null ? 'null' : typeof c}` }] };
  if ('is' in c) {
    const errors: GuardError[] = [];
    const needed = (operand: Operand): unknown => {
      if (!isRef(operand)) return operand;
      const found = host.resolve(operand.ref);
      if (found === undefined && host.missing === 'error') {
        errors.push({ message: `${describe(operand.ref)} has no value here; ask with "has" before comparing it`, ...(operand.loc ? { loc: operand.loc } : {}) });
      }
      return found;
    };
    const left = needed(c.is);
    const holds =
      left !== undefined &&
      c.values.some((v) => {
        const right = needed(v);
        return right !== undefined && right === left;
      });
    return trace(c, holds, { errors });
  }
  if ('has' in c) {
    const found = isRef(c.has) ? host.resolve(c.has.ref) : c.has;
    return trace(c, !(found === undefined || found === null || found === '' || (Array.isArray(found) && found.length === 0)));
  }
  if ('not' in c) {
    const child = run(c.not, host, stack);
    return trace(c, !child.holds, { children: [child] });
  }
  if ('all' in c || 'any' in c) {
    const all = 'all' in c;
    const children: Trace[] = [];
    for (const x of 'all' in c ? c.all : c.any) {
      const t = run(x, host, stack);
      children.push(t);
      if (t.holds !== all) return trace(c, !all, { children });
    }
    return trace(c, all, { children });
  }
  if ('guard' in c) {
    const name = c.guard;
    if (stack.includes(name)) return failed(c, `guard "${name}" depends on itself`);
    const guard = own(host.guards, name);
    if (guard === undefined) return failed(c, `no guard named "${name}"`);
    if (typeof guard === 'function') {
      const answer: unknown = (guard as GuardFn)(host);
      if (typeof answer === 'boolean') return trace(c, answer);
      if (typeof answer === 'object' && answer !== null && typeof (answer as { error?: unknown }).error === 'string') return failed(c, (answer as { error: string }).error);
      return failed(c, `the host's guard "${name}" returned ${typeof answer}, not true or false`);
    }
    stack.push(name);
    try {
      const body = run(guard, host, stack);
      return trace(c, body.holds, { children: [body] });
    } finally {
      stack.pop();
    }
  }
  if (typeof c.word !== 'string') return failed(c, 'not a condition: it has none of is, has, not, all, any, guard or word');
  const word: Word | undefined = own(host.words, c.word);
  if (!word) return failed(c, `no word named "${c.word}"`);
  const children = c.body?.map((x) => run(x, host, stack));
  const result = word.test(c.args ?? null, children, host);
  return trace(c, result.holds, { children, detail: result.detail });
}

/** The guards being answered for a host, so a word that evaluates again with the same host joins the same cycle check. */
const active = new WeakMap<Host, string[]>();

/** Evaluates a condition against a host. Never throws for what the condition says; a problem it finds is in the trace's `errors`. */
export function evaluate(condition: Condition, host: Host): Trace {
  const stack = active.get(host) ?? [];
  active.set(host, stack);
  try {
    return run(condition, host, stack);
  } finally {
    if (stack.length === 0) active.delete(host);
  }
}

/** Every error of a trace, node by node, depth first. */
export function errors(t: Trace): GuardError[] {
  return [...(t.errors ?? []), ...(t.children ?? []).flatMap(errors)];
}

/**
 * What is wrong with a condition before it is evaluated: a guard or a word the host does not have, a word's
 * own complaint about its use, a guard that depends on itself. Each problem once.
 */
export function problems(condition: Condition, host: Pick<Host, 'guards' | 'words'>): string[] {
  const found = new Set<string>();
  const checked = new Set<string>();
  const visit = (c: Condition, stack: string[]): void => {
    if ('not' in c) visit(c.not, stack);
    else if ('all' in c) c.all.forEach((x) => visit(x, stack));
    else if ('any' in c) c.any.forEach((x) => visit(x, stack));
    else if ('guard' in c) {
      const name = c.guard;
      const guard = own(host.guards, name);
      if (stack.includes(name)) found.add(`guard "${name}" depends on itself`);
      else if (guard === undefined) found.add(`no guard named "${name}"`);
      else if (typeof guard !== 'function' && !checked.has(name)) {
        visit(guard, [...stack, name]);
        checked.add(name);
      }
    } else if ('word' in c) {
      const word = own(host.words, c.word);
      if (!word) found.add(`no word named "${c.word}"`);
      else {
        const problem = word.read?.(c.args ?? null, c.body);
        if (problem) found.add(`word "${c.word}": ${problem}`);
      }
      c.body?.forEach((x) => visit(x, stack));
    }
  };
  visit(condition, []);
  return [...found];
}
