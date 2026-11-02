import { Compartment, EditorState, StateEffect, StateField, countColumn, findColumn } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, drawSelection, dropCursor, keymap, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, isolateHistory } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { renderMarkdown } from '../blog-markdown.mjs';
import { formatMarkdown } from './blog-format.js';

export const changeMode = StateEffect.define();
const liveMode = StateField.define({
  create: () => true,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(changeMode)) value = effect.value;
    return value;
  },
});

export const blockAction = StateEffect.define();
const blockLineGoal = StateEffect.define();
const blockLineColumn = StateField.define({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(blockLineGoal)) return effect.value;
    return transaction.docChanged || transaction.selection || transaction.effects.some(effect => effect.is(blockAction) || effect.is(changeMode)) ? null : value;
  },
});

// The default vertical command uses screen coordinates. Mixed heading sizes and
// block widgets make that unreliable for code, so source blocks use document lines.
export function moveBlockLine(view, direction, extend = false) {
  const state = view.state;
  if (state.selection.ranges.length !== 1) return false;
  const selection = state.selection.main;
  const editing = state.field(blockInteraction).editing.find(item => selection.head >= item.from && selection.head <= item.to);
  const block = editing ?? (!state.field(liveMode) ? codeBlocks(state).find(item => selection.head >= item.from && selection.head <= item.to) : null);
  // Markdown mode also needs logical line movement. It has no rendered widget
  // to enter first, so code sessions are opened by ordinary caret movement.
  if (!block && state.field(liveMode)) return false;
  const current = state.doc.lineAt(selection.head);
  const from = block?.from ?? 0, to = block?.to ?? state.doc.length;
  const first = state.doc.lineAt(from).number, last = state.doc.lineAt(to).number;
  const next = state.doc.line(Math.max(first, Math.min(last, current.number + direction)));
  const column = state.field(blockLineColumn) ?? countColumn(current.text, state.tabSize, selection.head - current.from);
  const head = Math.max(from, Math.min(to, next.from + findColumn(next.text, column, state.tabSize)));
  if (head !== selection.head || (!selection.empty && !extend) || (block && !editing)) {
    const effects = [blockLineGoal.of(column)];
    if (block && !editing) effects.push(blockAction.of({ kind: 'edit', from: block.from, to: block.to }));
    view.dispatch({ selection: { anchor: extend ? selection.anchor : head, head }, effects, userEvent: 'select', scrollIntoView: true });
  }
  return true;
}

function codeBlocks(state) {
  const blocks = [];
  syntaxTree(state).iterate({ enter(node) {
    if (node.name !== 'FencedCode' && node.name !== 'CodeBlock') return;
    blocks.push({ from: node.from, to: node.to }); return false;
  } });
  return blocks;
}

// Source editing is a session, rather than a consequence of where the caret is.
// Map its boundaries through edits so typing/removing a fence cannot collapse it.
export const blockInteraction = StateField.define({
  create(state) {
    const caret = state.selection.main;
    return { editing: caret.empty ? codeBlocks(state).filter(block => caret.head >= block.from && caret.head < block.to) : [], selected: null };
  },
  update(value, transaction) {
    const state = transaction.state, codes = codeBlocks(state);
    const treeChanged = syntaxTree(transaction.startState) !== syntaxTree(state);
    const map = block => {
      const from = transaction.changes.mapPos(block.from, -1), to = transaction.changes.mapPos(block.to, 1);
      if (from === to) return { from, to };
      return codes.find(code => code.from === from) ?? { from, to };
    };
    let editing = transaction.docChanged || treeChanged ? value.editing.map(map).filter(block => block.to > block.from) : [...value.editing];
    let selected = transaction.docChanged && value.selected ? map(value.selected) : value.selected;
    if (selected && (selected.from === selected.to || !state.selection.ranges.some(range => range.from === selected.from && range.to === selected.to))) selected = null;
    let explicit = false;
    for (const effect of transaction.effects) {
      if (!effect.is(blockAction)) continue;
      explicit = true;
      const { kind, from, to } = effect.value;
      if (kind === 'edit') {
        editing = [...editing.filter(block => block.from !== from), { from, to }]; selected = null;
      } else if (kind === 'finish') editing = editing.filter(block => block.from !== from);
      else if (kind === 'select') {
        editing = editing.filter(block => block.from !== from); selected = { from, to };
      } else if (kind === 'clear') selected = null;
    }
    if (!explicit && !selected && (transaction.docChanged || transaction.selection || treeChanged)) {
      const caret = state.selection.main;
      for (const block of codes) {
        let touched = caret.empty && caret.head >= block.from && caret.head < block.to;
        if (transaction.docChanged && caret.empty) transaction.changes.iterChangedRanges((_from, _to, from, to) => { if (from < block.to && to > block.from) touched = true; });
        if (touched && !editing.some(item => item.from === block.from)) editing.push(block);
      }
    }
    return { editing, selected };
  },
});

function editBlock(view, from, to) {
  view.dispatch({ effects: blockAction.of({ kind: 'edit', from, to }), selection: { anchor: from }, scrollIntoView: true }); view.focus();
}

function selectBlock(view, from, to) {
  view.dispatch({ effects: blockAction.of({ kind: 'select', from, to }), selection: { anchor: from, head: to }, scrollIntoView: true }); view.focus();
}

export function finishBlockEditing(view, block) {
  block ??= view.state.field(blockInteraction).editing.find(item => view.state.selection.main.head >= item.from && view.state.selection.main.head <= item.to)
    ?? view.state.field(blockInteraction).editing.at(-1);
  if (!block) return false;
  const anchor = block.to < view.state.doc.length ? block.to + 1 : block.to;
  view.dispatch({ effects: blockAction.of({ kind: 'finish', from: block.from }), selection: { anchor }, scrollIntoView: true }); view.focus?.();
  return true;
}

export function deleteSelectedBlock(view) {
  const block = view.state.field(blockInteraction).selected;
  if (!block || view.state.readOnly) return false;
  let { from, to } = block;
  if (view.state.doc.sliceString(to, to + 1) === '\n') to++;
  else if (from > 0 && view.state.doc.sliceString(from - 1, from) === '\n') from--;
  view.dispatch({ changes: { from, to, insert: '' }, selection: { anchor: from }, effects: blockAction.of({ kind: 'clear' }), userEvent: 'delete.selection', annotations: isolateHistory.of('full') });
  return true;
}

export function selectAdjacentBlock(view, direction) {
  const state = view.state, caret = state.selection.main;
  if (!state.field(liveMode) || !caret.empty) return false;
  for (const set of state.facet(EditorView.decorations)) {
    // Other extensions (including syntax highlighting) supply decorations as
    // view callbacks. Our block widgets are in a directly provided range set.
    if (typeof set === 'function') continue;
    let found = null;
    set.between(0, state.doc.length, (from, to, decoration) => {
      if (!decoration.spec.widget?.source) return;
      if (direction < 0 ? caret.head === to || (caret.head === to + 1 && state.doc.sliceString(to, to + 1) === '\n')
        : caret.head === from || (caret.head + 1 === from && state.doc.sliceString(caret.head, from) === '\n')) found = { from, to };
    });
    if (found) { selectBlock(view, found.from, found.to); return true; }
  }
  return false;
}

class MarkdownBlock extends WidgetType {
  constructor(source, from, to, options, selected = false) { super(); Object.assign(this, { source, from, to, options, selected }); }
  eq(other) { return this.source === other.source && this.from === other.from && this.to === other.to && this.selected === other.selected; }
  toDOM(view) {
    const root = document.createElement('div');
    root.className = `md-rendered-block blog-content${this.selected ? ' is-block-selected' : ''}`;
    root.innerHTML = renderMarkdown(this.source);
    root.tabIndex = 0; root.setAttribute('role', 'group');
    root.setAttribute('aria-label', `${this.selected ? 'Selected content' : 'Rendered content'}. Double-click or press Enter to edit source, Escape to finish, Delete to remove selected content.`);
    root.addEventListener('click', event => { if (!event.target.closest(this.options.onRender ? 'a,button,input,[data-image-src]' : 'a,button,input')) selectBlock(view, this.from, this.to); });
    root.addEventListener('dblclick', event => { if (!event.target.closest('a,button,input,[data-image-src]')) editBlock(view, this.from, this.to); });
    root.addEventListener('keydown', event => {
      if (event.target !== root) return;
      if (event.key === 'Enter') { event.preventDefault(); editBlock(view, this.from, this.to); }
      else if ([' ', 'Backspace', 'Delete'].includes(event.key)) {
        event.preventDefault();
        if (this.selected && event.key !== ' ') deleteSelectedBlock(view); else selectBlock(view, this.from, this.to);
      }
    });
    // Diagram rendering can change block height after CodeMirror's layout pass.
    queueMicrotask(async () => {
      if (!root.isConnected) return;
      try { await this.options.enhance?.(root); if (root.isConnected) this.options.onRender?.(root, { from: this.from, to: this.to }); }
      catch { /* Markdown remains readable if a progressive enhancement fails. */ }
      finally { if (root.isConnected) view.requestMeasure(); }
    });
    return root;
  }
  ignoreEvent() { return true; }
}

class TaskCheckbox extends WidgetType {
  constructor(checked, from) { super(); this.checked = checked; this.from = from; }
  eq(other) { return this.checked === other.checked && this.from === other.from; }
  toDOM(view) {
    const wrap = document.createElement('span'), checkbox = document.createElement('input');
    wrap.className = 'md-task'; checkbox.type = 'checkbox'; checkbox.checked = this.checked;
    checkbox.setAttribute('aria-label', 'Toggle task');
    checkbox.addEventListener('change', () => {
      view.dispatch({ changes: { from: this.from + 1, to: this.from + 2, insert: checkbox.checked ? 'x' : ' ' }, userEvent: 'input' });
      view.focus();
    });
    wrap.append(checkbox); return wrap;
  }
  ignoreEvent() { return true; }
}

// Decorations only change presentation. The Markdown document is never converted
// through HTML, so custom image attributes and unsupported syntax round-trip intact.
export function liveMarkdown(options = {}) {
  const field = StateField.define({
    create: state => decorate(state, options),
    update(value, transaction) {
      return transaction.docChanged || transaction.selection || transaction.effects.some(effect => effect.is(changeMode) || effect.is(blockAction)) || syntaxTree(transaction.startState) !== syntaxTree(transaction.state)
        ? decorate(transaction.state, options) : value;
    },
    provide: value => EditorView.decorations.from(value),
  });
  return [liveMode, blockInteraction, blockLineColumn, field, keymap.of([
    { key: 'ArrowUp', run: view => moveBlockLine(view, -1), shift: view => moveBlockLine(view, -1, true) },
    { key: 'ArrowDown', run: view => moveBlockLine(view, 1), shift: view => moveBlockLine(view, 1, true) },
    { key: 'Backspace', run: view => deleteSelectedBlock(view) || selectAdjacentBlock(view, -1) },
    { key: 'Delete', run: view => deleteSelectedBlock(view) || selectAdjacentBlock(view, 1) },
    { key: 'Enter', run: view => {
      const block = view.state.field(blockInteraction).selected;
      if (!block) return false;
      editBlock(view, block.from, block.to); return true;
    } },
    { key: 'Mod-Enter', run: view => finishBlockEditing(view) },
    { key: 'Escape', run: view => {
      const selected = view.state.field(blockInteraction).selected;
      if (!selected) return finishBlockEditing(view);
      view.dispatch({ effects: blockAction.of({ kind: 'clear' }), selection: { anchor: selected.to } }); return true;
    } },
  ])];
}

function decorate(state, options) {
  if (!state.field(liveMode)) return Decoration.none;
  const ranges = [], blocks = [], literals = [], doc = state.doc;
  const interaction = state.field(blockInteraction);
  const selected = (from, to) => interaction.selected?.from === from && interaction.selected?.to === to;
  const blockActive = (from, to) => state.selection.ranges.some(range => range.empty ? range.head >= from && range.head < to : range.from < to && range.to > from);
  const active = (from, to) => state.selection.ranges.some(range => range.from <= to && range.to >= from);
  const hide = (from, to) => { if (to > from) ranges.push(Decoration.replace({}).range(from, to)); };
  const mark = (from, to, className) => { if (to > from) ranges.push(Decoration.mark({ class: className }).range(from, to)); };
  const lineClass = (from, className) => ranges.push(Decoration.line({ class: className }).range(doc.lineAt(from).from));
  const codeLines = new Set();
  for (const block of interaction.editing) {
    const first = doc.lineAt(block.from), last = doc.lineAt(block.to);
    for (let number = first.number; number <= last.number; number++) {
      const line = doc.line(number); codeLines.add(number); lineClass(line.from, 'md-code-line md-editing-line');
    }
  }
  syntaxTree(state).iterate({ enter(node) {
    const { from, to, name } = node;
    const start = doc.lineAt(from), end = doc.lineAt(to);
    if (name !== 'Document' && interaction.editing.some(block => from >= block.from && from < block.to)) return false;
    if (['InlineCode', 'URL', 'Image'].includes(name)) literals.push({ from, to });
    // Images inserted by the existing toolbar may share a paragraph with the
    // preceding text. Render their own line without making that text a widget.
    if (name === 'Image' && /^\s*!\[/.test(start.text) && (selected(start.from, start.to) || !blockActive(start.from, start.to))) {
      if (!blocks.some(block => block.from === start.from)) {
        ranges.push(Decoration.replace({ widget: new MarkdownBlock(start.text, start.from, start.to, options, selected(start.from, start.to)), block: true }).range(start.from, start.to));
        blocks.push({ from: start.from, to: start.to });
      }
      return false;
    }
    if (['FencedCode', 'CodeBlock', 'Table'].includes(name)) {
      if ((selected(from, to) || !blockActive(start.from, end.to)) && from === start.from && to === end.to) {
        ranges.push(Decoration.replace({ widget: new MarkdownBlock(doc.sliceString(from, to), from, to, options, selected(from, to)), block: true }).range(from, to));
        blocks.push({ from, to });
        return false;
      }
      for (let number = start.number; number <= end.number; number++) {
        const line = doc.line(number); codeLines.add(number);
        lineClass(line.from, name === 'Table' ? 'md-table-source' : 'md-code-line');
      }
      return false;
    }
    if (/^ATXHeading[1-6]$/.test(name)) lineClass(from, `md-heading md-h${name.slice(-1)}`);
    if (name === 'HeaderMark' && !active(start.from, end.to)) hide(from, Math.min(to + 1, start.to));
    if (name === 'StrongEmphasis') mark(from, to, 'md-strong');
    if (name === 'Emphasis') mark(from, to, 'md-emphasis');
    if (name === 'Strikethrough') mark(from, to, 'md-strike');
    if (['EmphasisMark', 'StrikethroughMark', 'CodeMark'].includes(name) && !active(node.node.parent.from, node.node.parent.to)) hide(from, to);
    if (name === 'InlineCode') mark(from, to, 'md-inline-code');
    if (name === 'Blockquote') {
      for (let number = start.number; number <= end.number; number++) lineClass(doc.line(number).from, 'md-quote');
    }
    if (name === 'QuoteMark' && !active(start.from, start.to)) hide(from, Math.min(to + 1, start.to));
    if (name === 'ListMark' && !active(start.from, start.to)) {
      const ordered = /^\d/.test(doc.sliceString(from, to));
      if (!ordered) {
        const task = /^\s*\[[ xX]\]/.test(doc.sliceString(to, start.to));
        if (task) hide(from, Math.min(to + 1, start.to));
        else { hide(from, to); ranges.push(Decoration.widget({ widget: new Bullet(), side: -1 }).range(to)); }
      }
    }
    if (name === 'TaskMarker' && !active(from, to)) {
      ranges.push(Decoration.replace({ widget: new TaskCheckbox(doc.sliceString(from + 1, from + 2).toLowerCase() === 'x', from) }).range(from, to));
    }
    if (name === 'Link') {
      mark(from, to, 'md-link');
      if (!active(from, to)) {
        const text = doc.sliceString(from, to), match = /^\[([^\]]*)\]\([\s\S]*\)$/.exec(text);
        if (match) { hide(from, from + 1); hide(from + 1 + match[1].length, to); }
      }
    }
    if (name === 'HorizontalRule' && !active(from, to)) { lineClass(from, 'md-rule'); mark(from, to, 'md-rule-text'); }
  } });
  // These two small extensions match the existing blog renderer.
  let blockIndex = 0;
  for (let number = 1; number <= doc.lines; number++) {
    if (codeLines.has(number)) continue;
    const line = doc.line(number);
    // Skip lines contained in a rendered block.
    while (blocks[blockIndex]?.to < line.from) blockIndex++;
    if (blocks[blockIndex]?.from <= line.from && blocks[blockIndex]?.to >= line.to) continue;
    if (line.text.startsWith('-# ')) {
      lineClass(line.from, 'md-subtext');
      if (!active(line.from, line.to)) hide(line.from, line.from + 3);
    }
    for (const match of line.text.matchAll(/\+\+([^+\n]+)\+\+/g)) {
      const from = line.from + match.index, to = from + match[0].length;
      if (literals.some(range => range.from < to && range.to > from)) continue;
      mark(from, to, 'md-underline');
      if (!active(from, to)) { hide(from, from + 2); hide(to - 2, to); }
    }
  }
  return Decoration.set(ranges, true);
}

class Bullet extends WidgetType {
  toDOM() { const span = document.createElement('span'); span.textContent = '•'; span.className = 'md-bullet'; return span; }
}

function formatSelection(view, kind) {
  const selection = view.state.selection.main;
  const edit = formatMarkdown(view.state.doc.toString(), selection.from, selection.to, kind);
  if (!edit) return false;
  view.dispatch({ changes: { from: edit.start, to: edit.end, insert: edit.text }, selection: { anchor: edit.selectionStart, head: edit.selectionEnd }, userEvent: 'input.format' });
  return true;
}

export function bindComposerModes(editor, panes, controls) {
  const mobile = window.matchMedia('(max-width: 700px)');
  let requested = 'live';
  const modeFor = control => control.dataset.blogMode ?? control.dataset.noteMode;
  const apply = () => {
    const mode = mobile.matches ? 'live' : requested;
    panes.dataset.mode = mode;
    editor.setMode(mode);
    for (const control of controls) control.setAttribute('aria-pressed', String(modeFor(control) === mode));
  };
  for (const control of controls) control.addEventListener('click', () => { requested = modeFor(control); apply(); });
  mobile.addEventListener('change', apply);
  apply();
}

// A small textarea-compatible adapter keeps autosave, toolbar selection, uploads,
// image resizing, and source insertion on the same document and undo history.
export function createMarkdownEditor(textarea, options = {}) {
  const host = document.createElement('div'); host.className = 'markdown-editor';
  textarea.before(host); textarea.hidden = true;
  const readOnly = new Compartment();
  let programmatic = false, live = true, disabled = textarea.disabled;
  const maxLength = textarea.maxLength > 0 ? textarea.maxLength : 300000;
  const label = document.querySelector(`label[for="${textarea.id}"]`)?.textContent ?? 'Markdown';
  const extensions = () => [
    markdown({ base: markdownLanguage, completeHTMLTags: false }),
    liveMarkdown(options), history(), drawSelection(), dropCursor(), EditorView.lineWrapping,
    syntaxHighlighting(HighlightStyle.define([
      { tag: tags.heading, color: '#ededed', fontWeight: '600' },
      { tag: tags.strong, fontWeight: '700' }, { tag: tags.emphasis, fontStyle: 'italic' },
      { tag: tags.strikethrough, textDecoration: 'line-through' },
      { tag: tags.link, color: '#b8b0df' }, { tag: tags.url, color: '#8c85b0' },
      { tag: tags.monospace, color: '#dbbd9c' }, { tag: tags.processingInstruction, color: '#82828c' },
    ])),
    readOnly.of([EditorState.readOnly.of(disabled), EditorView.editable.of(!disabled)]),
    EditorView.contentAttributes.of({ 'aria-label': label, 'aria-multiline': 'true', spellcheck: 'true' }),
    placeholder(textarea.placeholder),
    keymap.of([{ key: 'Mod-b', run: view => formatSelection(view, 'bold') }, { key: 'Mod-i', run: view => formatSelection(view, 'italic') }, ...defaultKeymap, ...historyKeymap]),
    EditorState.transactionFilter.of(transaction => {
      if (!transaction.docChanged || transaction.newDoc.length <= maxLength) return transaction;
      options.onLimit?.(`Use up to ${maxLength.toLocaleString()} characters.`); return [];
    }),
    EditorView.updateListener.of(update => {
      if (!update.docChanged) return;
      textarea.value = update.state.doc.toString();
      if (!programmatic) textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }),
  ];
  const view = new EditorView({ state: EditorState.create({ doc: textarea.value, extensions: extensions() }), parent: host });
  const dispatch = transaction => { programmatic = true; try { view.dispatch(transaction); } finally { programmatic = false; } };
  return {
    get value() { return view.state.doc.toString(); },
    set value(value) {
      programmatic = true;
      try {
        view.setState(EditorState.create({ doc: value, extensions: extensions() }));
        if (!live) view.dispatch({ effects: changeMode.of(false) });
        textarea.value = value;
      } finally { programmatic = false; }
    },
    get selectionStart() { return view.state.selection.main.from; },
    get selectionEnd() { return view.state.selection.main.to; },
    get disabled() { return disabled; },
    set disabled(value) { disabled = value; textarea.disabled = value; view.dispatch({ effects: readOnly.reconfigure([EditorState.readOnly.of(value), EditorView.editable.of(!value)]) }); },
    focus() { view.focus(); view.requestMeasure(); },
    setRangeText(text, from, to, selectionMode = 'end') {
      dispatch({ changes: { from, to, insert: text }, selection: { anchor: selectionMode === 'select' ? from : from + text.length, head: from + text.length }, userEvent: 'input' });
    },
    setSelectionRange(from, to) { dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true }); },
    addEventListener(name, listener) {
      (name === 'input' ? textarea : view.contentDOM).addEventListener(name, event => {
        if (name === 'keydown' && event.target.closest('[contenteditable=false]')) return;
        listener(event);
      }, name !== 'input');
    },
    setMode(mode) { live = mode !== 'source'; host.classList.toggle('is-source', !live); view.dispatch({ effects: changeMode.of(live) }); view.requestMeasure(); },
  };
}
