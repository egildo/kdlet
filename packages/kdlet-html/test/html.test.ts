import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluate, read } from 'kdlet';
import type { OutNode } from 'kdlet';
import { RenderError, escape, render, vocabulary } from '../src/index.js';

function tree(text: string, inputs: Record<string, unknown> = {}): OutNode[] {
  const document = read(text);
  assert.deepEqual(document.problems, []);
  const r = evaluate(document, { vocabulary, inputs });
  assert.deepEqual(r.problems, []);
  return r.tree;
}

const html = (text: string, inputs: Record<string, unknown> = {}) => render(tree(text, inputs));

/** What `render` refuses, as `line:column message` lines. */
function refused(nodes: OutNode[]): string[] {
  try {
    render(nodes);
  } catch (error) {
    assert.ok(error instanceof RenderError);
    return error.problems.map((p) => `${p.line}:${p.column} ${p.message}`);
  }
  throw new Error('expected render to refuse');
}

test('a dotted name is an element and its classes', () => {
  assert.equal(html('tr.row.wide'), '<tr class="row wide"></tr>');
});

test('there is no implied div: a name that starts with a dot is an error at its node', () => {
  const r = evaluate(read('main {\n  .card "x"\n}'), { vocabulary });
  assert.deepEqual(r.problems.map((p) => `${p.line}:${p.column}`), ['2:3']);
  assert.match(r.problems[0].message, /no implied div; write the element, as in div\.card/);
  assert.match(evaluate(read('li..x'), { vocabulary }).problems[0].message, /empty class/);
  assert.match(evaluate(read('"a b"'), { vocabulary }).problems[0].message, /not an element name/);
});

test('an id is written id=main', () => {
  assert.equal(html('main id=main'), '<main id="main"></main>');
});

test('arguments are text, joined in order with nothing between', () => {
  assert.equal(html('p "Posted by " (input)who " on " 5', { who: 'Ana' }), '<p>Posted by Ana on 5</p>');
});

test('a child named - is text among child elements', () => {
  const doc = 'p {\n  - "Read "\n  a more href=(input)url\n  - " now"\n}';
  assert.equal(html(doc, { url: '/a' }), '<p>Read <a href="/a">more</a> now</p>');
});

test('a - node holds text only', () => {
  const nodes = tree('p {\n  - "x" class=a\n}');
  assert.deepEqual(refused(nodes), ['2:3 a "-" node holds text only']);
});

test('class and style add; every other attribute: the later write wins', () => {
  const doc = `guard g { has (input)g }
a.one class=two style="color:red" href="/a" {
    when g class=three style="margin:0;" href="/b"
}`;
  assert.equal(html(doc, { g: 1 }), '<a class="one two three" style="color:red;margin:0;" href="/b"></a>');
  assert.equal(html(doc), '<a class="one two" style="color:red;" href="/a"></a>');
});

test('#true writes a bare attribute; #false and #null write nothing', () => {
  assert.equal(html('input disabled=#true hidden=#false form=#null'), '<input disabled>');
});

test('numbers are text; an empty class or style is left out', () => {
  assert.equal(html('td colspan=2 class="" style=""'), '<td colspan="2"></td>');
});

test('every text and attribute value is escaped, whether written or read from an input', () => {
  assert.equal(html('p title="a \\"b\\" & <c>" "1 < 2 & 3 > 2"'), '<p title="a &quot;b&quot; &amp; &lt;c&gt;">1 &lt; 2 &amp; 3 &gt; 2</p>');
  const hostile = '<script>alert("x")</script>';
  assert.equal(html('p (input)v title=(input)v class=(input)v', { v: hostile }), '<p title="&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;" class="&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;">&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>');
  assert.equal(html('script "if (a < b) {}"'), '<script>if (a &lt; b) {}</script>');
  assert.equal(escape(`it's`), `it's`);
});

test('there is no way to write raw output: markup in text stays text', () => {
  assert.equal(html('div "<b>bold</b>"'), '<div>&lt;b&gt;bold&lt;/b&gt;</div>');
});

test('void elements have no closing tag', () => {
  assert.equal(html('p { br; img src="a.png" alt=""; hr }'), '<p><br><img src="a.png" alt=""><hr></p>');
  assert.deepEqual(refused(tree('br "text"')), ['1:1 "br" is a void element and takes no content']);
});

test('a call passed through unexpanded is an error for this renderer', () => {
  assert.deepEqual(refused(tree('main {\n  +Icon name=x\n}')), ['2:3 "+Icon" was not expanded; the HTML renderer needs a definition for it']);
});

test('a value that is not text or a number is an error with its position', () => {
  assert.deepEqual(refused(tree('p (input)v', { v: ['a'] })), ['1:3 text takes text or a number, not ["a"]']);
  assert.deepEqual(refused(tree('p title=#null alt=(input)v', { v: { a: 1 } })), ['1:15 "alt" takes text or a number, not {"a":1}']);
});

test('an attribute name that could break out of its tag is refused', () => {
  assert.deepEqual(refused(tree('p "a b"=1')), ['1:3 "a b" is not an attribute name']);
  assert.deepEqual(refused(tree('p "x\\"onload"=1')), ['1:3 "x"onload" is not an attribute name']);
});

test('the doctype option writes a doctype first, and nothing else changes', () => {
  assert.equal(render(tree('p "x"'), { doctype: true }), '<!DOCTYPE html>\n<p>x</p>');
  assert.equal(render(tree('p "x"')), '<p>x</p>');
});

test('page.kdl and page.kdlet are the same file', () => {
  const inputs = { title: 'Notes & more', author: 'Ana', profile: '/ana', logo: '/logo.svg' };
  const expected =
    '<html lang="en"><head><meta charset="utf-8"><title>Notes &amp; more</title></head>' +
    '<body class="page"><h1>Notes &amp; more</h1><p>Written by <a href="/ana">Ana</a>.</p><img src="/logo.svg" alt=""></body></html>';
  for (const extension of ['kdl', 'kdlet']) {
    const text = readFileSync(new URL(`./fixtures/page.${extension}`, import.meta.url), 'utf8');
    assert.equal(html(text, inputs), expected);
  }
});
