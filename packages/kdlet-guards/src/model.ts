/**
 * The types of kdlet-guards: a condition as plain data, the host that answers
 * for what a condition reads, and the trace an evaluation leaves.
 *
 * A condition is JSON all the way down, so it can be stored, sent and compared.
 * Positions (`loc`) are optional: the KDL reader fills them in, and an error
 * found at evaluation points at them when they are there.
 */

/** A position in a file, one-based, as an editor shows it. */
export type Loc = {
  line: number;
  column: number;
};

/** Something wrong, with where. */
export interface Problem {
  message: string;
  line: number;
  column: number;
}

/** What a KDL value can be. */
export type Primitive = string | number | boolean | null;

/** Plain JSON. */
export type Json = Primitive | Json[] | { [key: string]: Json };

/** `(input)title`: the field `title` of what the host calls `input`. The module does not know what `from` means. */
export interface Ref {
  from: string;
  field: string;
}

/**
 * What `resolve` may answer for a reference that is not yet known, as against `undefined`, which is a reference
 * with nothing there. A condition that reads it is neither true nor false: its trace says `unknown`.
 */
export const UNKNOWN: unique symbol = Symbol('UNKNOWN');

/** A plain value, or a reference the host resolves. */
export type Operand = Primitive | { ref: Ref; loc?: Loc };

export type Condition =
  /** The first operand equals one of the values. */
  | { is: Operand; values: Operand[]; loc?: Loc }
  /** There is something: not absent, not null, not empty text, not an empty list. `0` and `false` are something. */
  | { has: Operand; loc?: Loc }
  /** The first operand is earlier than the second, moved by `days` (dates only). Dates and instants never compare with each other. */
  | { before: [Operand, Operand]; days?: number; loc?: Loc }
  /** The first operand is later than the second, moved by `days` (dates only). */
  | { after: [Operand, Operand]; days?: number; loc?: Loc }
  /** The first operand is a smaller number than the second. Strict: equal is not less. */
  | { less: [Operand, Operand]; loc?: Loc }
  /** The first operand is a greater number than the second. Strict. */
  | { more: [Operand, Operand]; loc?: Loc }
  | { not: Condition; loc?: Loc }
  /** Every child holds. `all: []` holds. */
  | { all: Condition[]; loc?: Loc }
  /** At least one child holds. `any: []` does not. */
  | { any: Condition[]; loc?: Loc }
  /** A named guard of the host: a condition, or a function. */
  | { guard: string; loc?: Loc }
  /** A word the host registered. */
  | { word: string; args?: Json; body?: Condition[]; loc?: Loc };

/**
 * A guard supplied by code. It answers true or false, `'unknown'` when it cannot yet tell, or `{ error }` to say
 * why it cannot answer; the evaluation records that and takes the guard as false.
 */
export type GuardFn = (host: Host) => boolean | 'unknown' | { error: string };

export interface Host {
  /** What a reference stands for; `undefined` when there is nothing there, `UNKNOWN` when it is not yet known. `null` is a value. */
  resolve(ref: Ref): unknown;
  /** Named guards: a condition, or a function of the host. */
  guards?: Record<string, Condition | GuardFn>;
  /** Registered words. */
  words?: Record<string, Word>;
  /** What `is` does with an operand that is absent: record an error and take it as false, or just take it as false. */
  missing: 'error' | 'false';
}

/** A word the host adds to the language. A word with a `body` wraps conditions; one without is a leaf. */
export interface Word {
  /** What is wrong with this use of the word, as text, or nothing. Called by `problems`. */
  read?(args: Json, body: Condition[] | undefined): string | undefined;
  /**
   * `args` is `null` when the condition gave none. `body` holds the trace of every wrapped condition, all of them
   * evaluated, each with `unknown` where it applies. `unknown` set means `holds` is false.
   */
  test(args: Json, body: Trace[] | undefined, host: Host): { holds: boolean; unknown?: true; detail?: Json };
}

export interface GuardError {
  message: string;
  loc?: Loc;
}

/**
 * What an evaluation found out about one condition: whether it holds, and how, node by node. A node is true
 * (`holds`), false, or unknown, which is false with `unknown` set.
 */
export interface Trace {
  holds: boolean;
  /** The answer depends on a reference the host said is not yet known. Then `holds` is false. */
  unknown?: true;
  condition: Condition;
  /**
   * The traces of the conditions evaluated under this one, in order. `all` stops at the first child that
   * fails and `any` at the first that holds, so a later child has no trace. A `guard` has the trace of its
   * body; a word has one for every child of its body.
   */
  children?: Trace[];
  /** What a word reported about itself. */
  detail?: Json;
  /** What went wrong at this node (an operand absent under `missing: 'error'`, an unknown guard, a cycle). The node then does not hold. */
  errors?: GuardError[];
}
