import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { history, undo } from '@codemirror/commands';
import { blockAction, blockInteraction, changeMode, codeHighlightRanges, deleteSelectedBlock, finishBlockEditing, indentCode, liveMarkdown, moveBlockLine, selectAdjacentBlock } from '../server/admin/markdown-editor.js';

const stateFor = (doc, anchor = doc.length) => EditorState.create({ doc, selection: { anchor }, extensions: [markdown({ base: markdownLanguage }), liveMarkdown(), history()] });
function decorations(state) {
  const result = [];
  for (const set of state.facet(EditorView.decorations)) if (typeof set !== 'function') set.between(0, state.doc.length, (from, to, value) => result.push({ from, to, ...value.spec }));
  return result;
}
const renderedBlocks = state => decorations(state).filter(item => item.block && !item.editingControls);
const harness = state => {
  const view = { state, focus() {} };
  view.dispatch = transaction => { view.state = transaction.startState ? transaction.state : view.state.update(transaction).state; };
  return view;
};

test('Tab inserts four literal spaces inside fenced code; Shift-Tab unindents', () => {
  const source = '```cpp\nclass Vector {\n\n};\n```';
  const caret = source.indexOf('\n\n') + 1;
  const view = harness(stateFor(source, caret));
  assert.equal(indentCode(view), true);
  assert.equal(view.state.doc.toString(), source.slice(0, caret) + '    ' + source.slice(caret));
  assert.equal(view.state.selection.main.head, caret + 4);
  assert.equal(indentCode(view, true), true);
  assert.equal(view.state.doc.toString(), source);
  assert.equal(indentCode(harness(stateFor('ordinary prose'))), false);
});

test('C++ source token highlighting maps escaped HTML back to exact source ranges', () => {
  const source = '```cpp\nclass Vector {\n    const char* text = "<span>&";\n};\n```';
  const ranges = codeHighlightRanges(source);
  assert.ok(ranges.some(range => range.class.includes('hljs-keyword') && source.slice(range.from, range.to) === 'class'));
  assert.ok(ranges.some(range => range.class.includes('hljs-string') && source.slice(range.from, range.to) === '"<span>&"'));
  for (const range of ranges) assert.ok(range.from >= source.indexOf('\n') + 1 && range.to <= source.lastIndexOf('\n'));
});

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
    const rendered = renderedBlocks(state);
    assert.equal(rendered.length, 1, block);
    assert.equal(rendered[0].widget.source, block);
    assert.equal(renderedBlocks(state.update({ selection: { anchor: 1 } }).state).length, 0);
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
  assert.equal(renderedBlocks(state).length, 0);
  assert.equal(state.doc.toString(), source);
});

test('an inserted image renders on its own line without consuming neighboring paragraph text', () => {
  const image = '![Image](/blog/media/11111111-1111-4111-8111-111111111111){width=65 align=right}';
  const source = `Keep writing here.\n${image}\n`, state = stateFor(source);
  const blocks = renderedBlocks(state);
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

test('code and Mermaid source stay open with both fences until explicitly finished', () => {
  for (const language of ['javascript', 'mermaid']) {
    const block = `\`\`\`${language}\nA --> B\n\`\`\``, source = `Before\n\n${block}\n\nAfter`;
    const from = source.indexOf('```'), to = from + block.length;
    const view = harness(stateFor(source));
    view.dispatch({ selection: { anchor: from + 4 } });
    view.dispatch({ selection: { anchor: source.length } });
    assert.deepEqual(view.state.field(blockInteraction).editing, [{ from, to }]);
    assert.equal(renderedBlocks(view.state).length, 0);
    const codeLines = decorations(view.state).filter(item => item.class?.includes('md-editing-line')).map(item => view.state.doc.lineAt(item.from).text);
    assert.deepEqual(codeLines, block.split('\n'));
    assert.equal(finishBlockEditing(view), true);
    assert.equal(view.state.field(blockInteraction).editing.length, 0);
    assert.equal(renderedBlocks(view.state)[0].widget.source, block);
    assert.equal(view.state.doc.toString(), source);
  }
});

test('typing a fence and its closing delimiter does not exit source editing', () => {
  const view = harness(stateFor('Before\n\n'));
  for (const text of ['```', 'mermaid\n', 'flowchart LR\n  A --> B\n', '```', '\n\nAfter']) {
    const from = view.state.selection.main.head;
    view.dispatch({ changes: { from, insert: text }, selection: { anchor: from + text.length } });
  }
  assert.equal(view.state.field(blockInteraction).editing.length, 1);
  assert.equal(renderedBlocks(view.state).length, 0);
  assert.equal(finishBlockEditing(view), true);
  assert.equal(renderedBlocks(view.state).length, 1);
});

test('temporarily editing either fence keeps the source session without adding block controls', () => {
  const source = 'Before\n\n```js\nconst x = 1;\n```\n\nAfter', from = source.indexOf('```');
  const view = harness(stateFor(source));
  view.dispatch({ selection: { anchor: from + 1 } });
  view.dispatch({ changes: { from, to: from + 1 }, selection: { anchor: from } });
  view.dispatch({ selection: { anchor: view.state.doc.length } });
  assert.equal(view.state.field(blockInteraction).editing.length, 1);
  assert.equal(decorations(view.state).filter(item => item.editingControls).length, 0);
  assert.equal(renderedBlocks(view.state).length, 0);
});

test('whole-block selection keeps the preview selected and deletes both fences as one undoable edit', () => {
  for (const block of ['```js\nconst x = 1;\n```', '```mermaid\nflowchart LR\n  A --> B\n```', '| A |\n| - |\n| B |', '![Image](/blog/media/11111111-1111-4111-8111-111111111111){width=65 align=right}']) {
    const source = `Before\n\n${block}\n\nAfter`, from = source.indexOf(block), to = from + block.length;
    const view = harness(stateFor(source));
    view.dispatch({ selection: { anchor: from, head: to }, effects: blockAction.of({ kind: 'select', from, to }) });
    assert.equal(renderedBlocks(view.state)[0].widget.selected, true);
    assert.equal(view.state.field(blockInteraction).editing.length, 0);
    assert.equal(deleteSelectedBlock(view), true);
    assert.equal(view.state.doc.toString(), 'Before\n\n\nAfter');
    assert.equal(view.state.field(blockInteraction).selected, null);
    assert.equal(undo(view), true);
    assert.equal(view.state.doc.toString(), source);
  }
});

test('block boundaries track edits before them, and removing a source block clears its session', () => {
  const block = '```js\nx=1;\n```', source = `Before\n\n${block}\n\nAfter`, from = source.indexOf(block);
  const view = harness(stateFor(source));
  view.dispatch({ selection: { anchor: from + 4 } });
  view.dispatch({ changes: { from: 0, insert: 'New heading\n\n' } });
  const editing = view.state.field(blockInteraction).editing[0];
  assert.equal(view.state.doc.sliceString(editing.from, editing.to), block);
  view.dispatch({ changes: { from: editing.from, to: editing.to }, selection: { anchor: editing.from } });
  assert.equal(view.state.field(blockInteraction).editing.length, 0);
});

test('Backspace beside a rendered block selects before deleting, including with indirect decorations installed', () => {
  const source = 'Before\n\n```js\nconst x = 1;\n```\n';
  const state = EditorState.create({ doc: source, selection: { anchor: source.length }, extensions: [markdown({ base: markdownLanguage }), EditorView.decorations.of(() => Decoration.none), liveMarkdown(), history()] });
  const view = harness(state);
  assert.equal(selectAdjacentBlock(view, -1), true);
  assert.equal(view.state.doc.toString(), source);
  assert.equal(renderedBlocks(view.state)[0].widget.selected, true);
  assert.equal(deleteSelectedBlock(view), true);
  assert.equal(view.state.doc.toString(), 'Before\n\n');
  assert.equal(undo(view), true);
  assert.equal(view.state.doc.toString(), source);
});

test('Up and Down visit every code and Mermaid line, including blank lines and both fences', () => {
  for (const language of ['javascript', 'mermaid']) {
    const source = `# Heading\n\nBefore\n\n\`\`\`${language}\nfirst\nsecond\n\nthird\nfourth\n\`\`\`\n\nAfter`;
    const from = source.indexOf('```'), view = harness(stateFor(source));
    view.dispatch({ effects: blockAction.of({ kind: 'edit', from, to: source.lastIndexOf('```') + 3 }), selection: { anchor: from } });
    const first = view.state.doc.lineAt(from).number;
    for (let line = first + 1; line <= first + 6; line++) {
      assert.equal(moveBlockLine(view, 1), true);
      assert.equal(view.state.doc.lineAt(view.state.selection.main.head).number, line);
    }
    const bottom = view.state.selection.main.head;
    moveBlockLine(view, 1);
    assert.equal(view.state.selection.main.head, bottom);
    for (let line = first + 5; line >= first; line--) {
      assert.equal(moveBlockLine(view, -1), true);
      assert.equal(view.state.doc.lineAt(view.state.selection.main.head).number, line);
    }
    moveBlockLine(view, -1);
    assert.equal(view.state.selection.main.head, from);
    assert.equal(view.state.field(blockInteraction).editing.length, 1);
    assert.equal(view.state.doc.toString(), source);
  }
});

test('vertical code navigation preserves the column through short and empty lines', () => {
  const source = '```js\nabcdefghij\nx\n\nabcdefghij\n```', view = harness(stateFor(source, 12));
  const column = view.state.selection.main.head - view.state.doc.lineAt(view.state.selection.main.head).from;
  moveBlockLine(view, 1);
  assert.equal(view.state.selection.main.head, view.state.doc.line(3).to);
  moveBlockLine(view, 1);
  assert.equal(view.state.selection.main.head, view.state.doc.line(4).from);
  moveBlockLine(view, 1);
  assert.equal(view.state.selection.main.head, view.state.doc.line(5).from + column);
  moveBlockLine(view, -1); moveBlockLine(view, -1); moveBlockLine(view, -1);
  assert.equal(view.state.selection.main.head, view.state.doc.line(2).from + column);
});

test('Shift+Up/Down selects one code line at a time and keeps its anchor', () => {
  const source = '```js\nfirst\nsecond\nthird\n```', from = source.indexOf('second') + 2, view = harness(stateFor(source, from));
  moveBlockLine(view, 1, true);
  assert.equal(view.state.selection.main.anchor, from);
  assert.equal(view.state.selection.main.head, source.indexOf('third') + 2);
  moveBlockLine(view, -1, true);
  assert.equal(view.state.selection.main.anchor, from);
  assert.equal(view.state.selection.main.head, from);
  moveBlockLine(view, -1, true);
  assert.equal(view.state.selection.main.head, source.indexOf('first') + 2);
});

test('ordinary prose keeps normal arrow handling and finishing code releases the boundary', () => {
  const source = 'Before\n\n```js\nfirst\nsecond\n```\n\nAfter', view = harness(stateFor(source));
  assert.equal(moveBlockLine(view, -1), false);
  view.dispatch({ selection: { anchor: source.indexOf('first') } });
  assert.equal(moveBlockLine(view, -1), true);
  assert.equal(finishBlockEditing(view), true);
  assert.equal(moveBlockLine(view, 1), false);
});

test('Markdown mode opens source code sessions without needing a Live-mode Edit source button', () => {
  for (const language of ['javascript', 'mermaid']) {
    const source = `# Heading\n\nBefore\n\n\`\`\`${language}\nfirst\nsecond\n\nthird\n\`\`\`\n\nAfter`;
    const view = harness(stateFor(source));
    view.dispatch({ effects: changeMode.of(false) });
    view.dispatch({ selection: { anchor: source.indexOf('second') + 2 } });
    assert.equal(view.state.field(blockInteraction).editing.length, 1);
    assert.equal(decorations(view.state).length, 0);
    const line = view.state.doc.lineAt(view.state.selection.main.head).number;
    moveBlockLine(view, -1);
    assert.equal(view.state.doc.lineAt(view.state.selection.main.head).number, line - 1);
    moveBlockLine(view, 1);
    assert.equal(view.state.doc.lineAt(view.state.selection.main.head).number, line);
    moveBlockLine(view, 1);
    assert.equal(view.state.doc.lineAt(view.state.selection.main.head).number, line + 1);
    moveBlockLine(view, -1);
    assert.equal(view.state.doc.lineAt(view.state.selection.main.head).number, line);
    for (let i = 0; i < 20; i++) moveBlockLine(view, -1);
    assert.equal(view.state.doc.lineAt(view.state.selection.main.head).text, `\`\`\`${language}`);
    for (let i = 0; i < 20; i++) moveBlockLine(view, 1);
    assert.equal(view.state.doc.lineAt(view.state.selection.main.head).text, '```');
    assert.equal(finishBlockEditing(view), true);
    assert.equal(decorations(view.state).filter(item => item.editingControls).length, 0);
    assert.equal(renderedBlocks(view.state).length, 0);
    assert.equal(view.state.doc.toString(), source);
  }
});

test('Markdown mode uses logical lines in prose too, and restores the column after blank lines', () => {
  const source = '# Heading\n\nBefore\n\nAfter', view = harness(stateFor(source, 4));
  view.dispatch({ effects: changeMode.of(false) });
  for (const line of [2, 3, 4, 5]) {
    assert.equal(moveBlockLine(view, 1), true);
    assert.equal(view.state.doc.lineAt(view.state.selection.main.head).number, line);
  }
  assert.equal(view.state.selection.main.head, view.state.doc.line(5).from + 4);
  for (const line of [4, 3, 2, 1]) {
    moveBlockLine(view, -1);
    assert.equal(view.state.doc.lineAt(view.state.selection.main.head).number, line);
  }
  assert.equal(view.state.doc.toString(), source);
});

test('Markdown mode handles a caret at the final fence and an unfinished fence at EOF', () => {
  for (const source of ['Before\n\n```js\nfirst\nsecond\n```', 'Before\n\n```']) {
    const view = harness(stateFor(source));
    view.dispatch({ effects: changeMode.of(false) });
    for (let i = 0; i < 10; i++) moveBlockLine(view, -1);
    assert.equal(view.state.doc.lineAt(view.state.selection.main.head).number, 3);
    assert.equal(view.state.field(blockInteraction).editing.length, 1);
    assert.equal(decorations(view.state).length, 0);
    assert.equal(view.state.doc.toString(), source);
  }
});
