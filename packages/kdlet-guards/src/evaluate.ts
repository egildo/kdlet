/**
 * A condition and a host to a trace: `check`'s answer with every node's result.
 *
 * The semantics are `check`'s and live there; this only listens to it and keeps
 * what it hears as a tree, so the tracing is a bundle's cost only when it asks
 * for a trace.
 */

import { check, own } from './check.js';
import type { Observer } from './check.js';
import type { Condition, GuardError, Host, Trace } from './model.js';

/** Builds a trace from what a check reports. */
function tracer(): Observer {
  const open: Trace[] = [];
  const observer: Observer = {
    enter: (condition) => void open.push({ holds: false, condition }),
    error: (error) => void (open[open.length - 1].errors ??= []).push(error),
    leave(holds, detail) {
      const node = open.pop() as Trace;
      node.holds = holds;
      if (detail !== undefined) node.detail = detail;
      const parent = open[open.length - 1];
      if (parent) (parent.children ??= []).push(node);
      observer.last = node;
    },
  };
  return observer;
}

/** Evaluates a condition against a host. Never throws for what the condition says; a problem it finds is in the trace's `errors`. */
export function evaluate(condition: Condition, host: Host): Trace {
  const observer = tracer();
  check(condition, host, observer);
  return observer.last as Trace;
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
