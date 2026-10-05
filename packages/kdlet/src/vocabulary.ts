import type { Vocabulary } from './model.js';

/** The names no element may take. `(element)when` is the escape for a node that must. */
export const RESERVED = ['define', 'guard', 'when', 'else', 'each', 'block'] as const;

/** Tags the language owns on values (`input`) and on nodes (`element`). */
const OWN_TAGS = ['input', 'element'];

/**
 * Registers a vocabulary: refuses one whose words collide with the language's,
 * so a collision is found once, here, and never in an author's file. Returns
 * the vocabulary it was given.
 */
export function defineVocabulary(vocabulary: Vocabulary): Vocabulary {
  const clash = (what: string, names: readonly string[], refused: readonly string[]) => {
    for (const name of names) {
      if (refused.includes(name)) throw new Error(`vocabulary: ${what} "${name}" is a word of the language`);
      if (what !== 'tag' && name.startsWith('+')) throw new Error(`vocabulary: ${what} "${name}" starts with "+", which marks a call`);
    }
  };
  if (vocabulary.elements !== '*') clash('element', vocabulary.elements, RESERVED);
  clash('child field', vocabulary.childFields ?? [], RESERVED);
  clash('tag', vocabulary.tags ?? [], OWN_TAGS);
  return vocabulary;
}
