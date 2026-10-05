/** The manual is a test: its examples are read, and its worked examples are run. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluate, read } from 'kdlet';
import { render, vocabulary } from '../src/index.js';

const manual = readFileSync(new URL('../../../docs/manual.md', import.meta.url), 'utf8');

interface Block {
  lang: string;
  label?: string;
  body: string;
  line: number;
}

const blocks: Block[] = [...manual.matchAll(/^```(\w+)(?: ([\w-]+))?\n([\s\S]*?)^```$/gm)].map((m) => ({
  lang: m[1],
  label: m[2],
  body: m[3],
  line: manual.slice(0, m.index).split('\n').length,
}));

const labelled = (lang: string, label: string): Block => {
  const found = blocks.find((b) => b.lang === lang && b.label === label);
  assert.ok(found, `the manual has no ${lang} block labelled ${label}`);
  return found;
};

test('every KDL fence of the manual is found', () => {
  const fences = manual.split('\n').filter((l) => /^```kdl\b/.test(l)).length;
  assert.ok(fences > 0);
  assert.equal(blocks.filter((b) => b.lang === 'kdl').length, fences);
});

test('every KDL example in the manual is read without problems', () => {
  for (const block of blocks.filter((b) => b.lang === 'kdl')) {
    const { problems } = read(block.body);
    assert.deepEqual(problems, [], `the example at manual.md:${block.line} has problems`);
  }
});

for (const name of ['nav-menu', 'post-list']) {
  test(`worked example ${name}: evaluated with the inputs shown, it renders to exactly the output shown`, () => {
    const inputs = JSON.parse(labelled('json', `${name}-inputs`).body);
    const result = evaluate(read(labelled('kdl', name).body), { vocabulary, inputs });
    assert.deepEqual(result.problems, []);
    assert.equal(render(result.tree), labelled('html', `${name}-output`).body.trim());
  });
}

test('the made-up switch example in the manual is the fixture the tests run', () => {
  const fixture = readFileSync(new URL('../../kdlet/test/fixtures/switch.kdlet', import.meta.url), 'utf8');
  assert.equal(labelled('kdl', 'switch').body.trim(), fixture.trim());
});

test('the made-up tracks example in the manual is the fixture the tests run', () => {
  const fixture = readFileSync(new URL('../../kdlet/test/fixtures/tracks.kdlet', import.meta.url), 'utf8');
  assert.equal(labelled('kdl', 'tracks').body.trim(), fixture.trim());
});
