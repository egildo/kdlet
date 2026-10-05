import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { read } from '../src/index.js';

const problems = (text: string, words?: string[]): string[] =>
  read(text, { words }).problems.map((p) => `${p.line}:${p.column} ${p.message}`);

/** One problem, at this position, saying this. */
function refused(text: string, at: string, message: RegExp, words?: string[]): void {
  const found = problems(text, words);
  assert.equal(found.length, 1, `expected one problem, got:\n${found.join('\n')}`);
  assert.match(found[0], new RegExp(`^${at} `));
  assert.match(found[0], message);
}

test('a file in either extension reads to the same document', () => {
  const kdl = read(readFileSync(new URL('./fixtures/switch.kdl', import.meta.url), 'utf8'));
  const kdlet = read(readFileSync(new URL('./fixtures/switch.kdlet', import.meta.url), 'utf8'));
  assert.deepEqual(kdl.problems, []);
  assert.deepEqual(kdlet, kdl);
});

test('invalid KDL is one problem at the place KDL gave up', () => {
  refused('a {', '1:4', /not valid KDL/);
});

test('a property written twice is refused at the second', () => {
  refused('a x=1 x=2', '1:7', /"x" is written twice on "a"/);
});

test('an each needs in, key and a body, and takes nothing else', () => {
  refused('each post key=slug { li }', '1:1', /needs in=/);
  refused('each post in=(input)posts { li }', '1:1', /needs key=/);
  refused('each post in=(input)posts key=slug', '1:1', /needs a body/);
  refused('each post in=(input)posts key=slug sort=up { li }', '1:36', /no "sort"/);
  refused('each in=(input)posts key=slug { li }', '1:1', /item name/);
  refused('each post in=posts key=slug { li }', '1:11', /takes a reference to a list/);
});

test('an item cannot be called input or element, nor reuse an enclosing item name', () => {
  refused('each input in=(input)xs key=k { li }', '1:6', /cannot be an item name/);
  refused('each element in=(input)xs key=k { li }', '1:6', /cannot be an item name/);
  refused('each a in=(input)xs key=k {\n  each a in=(a)ys key=k { li }\n}', '2:8', /already names the item/);
});

test('an else needs a when or an each right before it', () => {
  refused('p { else class=x }', '1:5', /no "when" or "each" just before/);
  refused('guard g { has (input)x }\np {\n  when g class=a\n  else class=b\n  else class=c\n}', '5:3', /no "when" or "each" just before/);
  refused('guard g { has (input)x }\np {\n  when g class=a\n  q\n  else class=b\n}', '5:3', /no "when" or "each" just before/);
});

test('an else after an each takes no guard, and no fields where there is no element', () => {
  refused('guard g { has (input)x }\neach a in=(input)xs key=k { li }\nelse g { li }', '3:6', /takes no guard/);
  refused('each a in=(input)xs key=k { li }\nelse class=x { li }', '2:6', /no element here to take fields/);
});

test('a when names at least one guard, and every guard must be in scope', () => {
  refused('p { when class=x }', '1:5', /names no guard/);
  refused('guard g { has (input)x }\np { when h class=a }', '2:10', /no guard named "h" is in scope/);
});

test('a when stands directly in an element', () => {
  refused('guard g { has (input)x }\nwhen g class=a', '2:1', /directly in an element's body/);
  refused('guard g { has (input)x }\neach a in=(input)xs key=k {\n  when g class=a\n}', '3:3', /directly in an element's body/);
});

test('a definition is closed: it does not see guards written outside it', () => {
  refused('guard g { has (input)x }\ndefine d {\n  p { when g class=a }\n}', '3:12', /no guard named "g"/);
});

test('guards: shadowing and writing twice are refused', () => {
  refused('guard g { has (input)x }\np {\n  guard g { has (input)y }\n}', '3:3', /already defined in an enclosing scope/);
  refused('guard g { has (input)x }\nguard g { has (input)y }', '2:1', /written twice in one body/);
});

test('a guard body takes only its own words, shaped right', () => {
  refused('guard g { when x }', '1:11', /takes is, has, not, all and any, not "when"/);
  refused('guard g { is "a" b }', '1:14', /starts with a reference/);
  refused('guard g { is (input)a }', '1:11', /"is" takes a reference and at least one value/);
  refused('guard g { has (input)a (input)b }', '1:11', /"has" takes one reference/);
  refused('guard g { not nothing }', '1:15', /no guard named "nothing"/);
  refused('guard g { all { } }', '1:11', /"all" needs a body/);
  refused('guard g { }', '1:1', /empty body/);
});

test('a reference names one field: a path is refused', () => {
  refused('each post in=(input)xs key=k { p (post)author.name }', '1:34', /single field/);
});

test('define stands at the top, once per name, with a body', () => {
  refused('p { define d { q } }', '1:5', /top of the file/);
  refused('define d { p }\ndefine d { q }', '2:1', /defined twice/);
  refused('define d', '1:1', /needs a body/);
  refused('define d title title { p }', '1:16', /parameter "title" is written twice/);
  refused('define d title=(input)x { p }', '1:10', /plain value/);
});

test('block belongs inside a define, once', () => {
  refused('p { block }', '1:5', /inside a "define"/);
  refused('define d { block\n block }', '2:2', /one "block"/);
});

test('a call takes its values by name', () => {
  refused('+card "Opening hours"', '1:7', /by name/);
  refused('+', '1:1', /name of a definition/);
});

test('an unknown tag on a node is refused', () => {
  refused('(foo)p', '1:1', /unknown tag "\(foo\)" on a node/);
});

test('(element) forces a node that would be a reserved word to be an element', () => {
  const doc = read('(element)when "Hours"\n(element)each');
  assert.deepEqual(doc.problems, []);
  assert.deepEqual(
    doc.nodes.map((n) => n.kind === 'element' && [n.name, n.forced]),
    [['when', true], ['each', true]],
  );
});

test('every problem of a file is reported in one run, each with its position', () => {
  const found = problems('p x=1 x=2\nelse\neach a key=k { li }');
  assert.deepEqual(found.map((f) => f.split(' ')[0]), ['1:7', '2:1', '3:1']);
});

test('top-level words of the host come back unread, with their position', () => {
  const doc = read('settings theme=dark {\n  anything goes\n}\np "hello"\n(element)settings', { words: ['settings'] });
  assert.deepEqual(doc.problems, []);
  const [host, p, forced] = doc.nodes;
  assert.equal(host.kind, 'host');
  assert.deepEqual(host.loc, { line: 1, column: 1 });
  assert.equal(host.kind === 'host' && host.node.getProperty('theme'), 'dark');
  assert.equal(host.kind === 'host' && host.node.children?.nodes[0].getName(), 'anything');
  assert.equal(p.kind, 'element');
  assert.equal(forced.kind, 'element');
});

test('a host word is only a word at the top, and cannot be a reserved word', () => {
  const doc = read('p { settings }', { words: ['settings'] });
  assert.equal(doc.nodes[0].kind === 'element' && doc.nodes[0].children[0].kind, 'element');
  assert.throws(() => read('p', { words: ['each'] }), /word of the language/);
  assert.throws(() => read('p', { words: ['+x'] }), /word of the language/);
});
