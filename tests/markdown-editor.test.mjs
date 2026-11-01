import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { liveMarkdown } from '../server/admin/markdown-editor.js';

const stateFor = (doc, anchor = doc.length) => EditorState.create({ doc, selection: { anchor }, extensions: [markdown({ base: markdownLanguage }), liveMarkdown()] });
function decorations(state) {
  const result = [];
  for (const set of state.facet(EditorView.decorations)) set.between(0, state.doc.length, (from, to, value) => result.push({ from, to, ...value.spec }));
  return result;
}

test('live Markdown styles headings and inline formatting without rewriting source', () => {
  const source = '# Heading\n\n**bold** *emphasis* ~~strike~~ ++underline++ `code`\n\n-# Small text\n\nEnd';
  const state = stateFor(source), styles = decorations(state).map(item => item.class).filter(Boolean);
  for (const style of ['md-heading md-h1', 'md-strong', 'md-emphasis', 'md-strike', 'md-underline', 'md-inline-code', 'md-subtext']) assert.ok(styles.includes(style), style);
  assert.equal(state.doc.toString(), source);
});

test('formatting markers reveal when the cursor enters the formatted text', () => {
  const source = '**bold**\n\nOther text', state = stateFor(source);
  const hidden = decorations(state).filter(item => item.to > item.from && !item.class && !item.widget);
  assert.ok(hidden.some(item => item.from === 0 && item.to === 2));
  const editing = state.update({ selection: { anchor: 4 } }).state;
  assert.equal(decorations(editing).filter(item => item.to > item.from && !item.class && !item.widget).length, 0);
  assert.equal(editing.doc.toString(), source);
});

test('code, tables, and uploaded images render in place and reveal their exact source on selection', () => {
  const image = '![Description](/blog/media/11111111-1111-4111-8111-111111111111 "Caption"){width=65 align=right}';
  const blocks = ['```mermaid\nflowchart LR\n  A --> B\n```', '| A | B |\n| - | - |\n| 1 | 2 |', image];
  for (const block of blocks) {
    const source = `${block}\n\nEnd`, state = stateFor(source);
    const rendered = decorations(state).filter(item => item.block);
    assert.equal(rendered.length, 1, block);
    assert.equal(rendered[0].widget.source, block);
    assert.equal(decorations(state.update({ selection: { anchor: 1 } }).state).filter(item => item.block).length, 0);
    assert.equal(state.doc.toString(), source);
  }
});

test('task widgets reflect saved state while code examples keep literal task syntax', () => {
  const source = '- [x] Done\n- [ ] Pending\n\n```text\n- [x] Example\n++literal++\n```\n\nEnd';
  const state = stateFor(source), tasks = decorations(state).filter(item => item.widget && 'checked' in item.widget);
  assert.deepEqual(tasks.map(item => item.widget.checked), [true, false]);
  assert.equal(state.doc.toString(), source);
});

test('selection spanning rendered blocks leaves the selected Markdown editable', () => {
  const source = 'Start\n\n```js\nconst value = 1;\n```\n\nEnd';
  const state = stateFor(source).update({ selection: { anchor: 0, head: source.length } }).state;
  assert.equal(decorations(state).filter(item => item.block).length, 0);
  assert.equal(state.doc.toString(), source);
});

test('an inserted image renders on its own line without consuming neighboring paragraph text', () => {
  const image = '![Image](/blog/media/11111111-1111-4111-8111-111111111111){width=65 align=right}';
  const source = `Keep writing here.\n${image}\n`, state = stateFor(source);
  const blocks = decorations(state).filter(item => item.block);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].widget.source, image);
  assert.equal(blocks[0].from, 'Keep writing here.\n'.length);
  assert.equal(state.doc.toString(), source);
});

test('custom underline syntax stays literal inside inline code and link destinations', () => {
  const source = '`++literal++` and [link](https://example.com/++path++)\n\nEnd';
  const state = stateFor(source);
  assert.equal(decorations(state).filter(item => item.class === 'md-underline').length, 0);
  assert.equal(state.doc.toString(), source);
});
