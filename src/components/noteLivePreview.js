// Obsidian-style live preview for CodeMirror: the file stays plain Markdown and only
// decorations change, so hidden syntax reappears on the line being edited.
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import { StateEffect } from "@codemirror/state";
import { Language, defineLanguageFacet, syntaxTree } from "@codemirror/language";
import { parser as markdownParser, GFM } from "@lezer/markdown";
import { parseWikilink } from "../utils/wikilinks";

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;

// Dispatched when resolvers change so links and images re-render
export const refreshLivePreview = StateEffect.define();

// ==highlight==, delimited like GFM strikethrough
const HighlightDelim = { resolve: "Highlight", mark: "HighlightMark" };
const Highlight = {
  defineNodes: [{ name: "Highlight" }, { name: "HighlightMark" }],
  parseInline: [{
    name: "Highlight",
    parse(cx, next, pos) {
      if (next !== 61 || cx.char(pos + 1) !== 61 || cx.char(pos + 2) === 61) return -1;
      const before = cx.slice(pos - 1, pos);
      const after = cx.slice(pos + 2, pos + 3);
      const spaceBefore = /\s|^$/.test(before);
      const spaceAfter = /\s|^$/.test(after);
      return cx.addDelimiter(HighlightDelim, pos, pos + 2, !spaceAfter, !spaceBefore);
    },
    after: "Emphasis",
  }],
};

// [[Note]], [[Note|Alias]] and ![[embed]]
const WikiLink = {
  defineNodes: [{ name: "WikiLink" }, { name: "WikiLinkMark" }],
  parseInline: [{
    name: "WikiLink",
    parse(cx, next, pos) {
      const embed = next === 33 && cx.char(pos + 1) === 91 && cx.char(pos + 2) === 91;
      if (!embed && !(next === 91 && cx.char(pos + 1) === 91)) return -1;
      const open = pos + (embed ? 3 : 2);
      const match = /^[^[\]\n]+?\]\]/.exec(cx.slice(open, cx.end));
      if (!match) return -1;
      const end = open + match[0].length;
      return cx.addElement(cx.elt("WikiLink", pos, end, [
        cx.elt("WikiLinkMark", pos, open),
        cx.elt("WikiLinkMark", end - 2, end),
      ]));
    },
    before: "Link",
  }],
};

// Built straight on @lezer/markdown: @codemirror/lang-markdown also bundles HTML, CSS and JS
// support for code blocks, roughly doubling the editor's size for nothing the preview uses
const noteMarkdown = new Language(
  defineLanguageFacet(),
  markdownParser.configure([GFM, Highlight, WikiLink]),
  [],
  "markdown",
);

class ImageWidget extends WidgetType {
  constructor(src, alt) {
    super();
    this.src = src;
    this.alt = alt;
  }
  eq(other) { return other.src === this.src && other.alt === this.alt; }
  toDOM() {
    const img = document.createElement("img");
    img.className = "cm-lp-image";
    img.src = this.src;
    img.alt = this.alt || "";
    img.addEventListener("error", () => { img.style.display = "none"; }, { once: true });
    return img;
  }
  // Clicking the image moves the cursor onto its line, which reveals the source
  ignoreEvent() { return false; }
}

class BulletWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-lp-bullet";
    span.textContent = "•";
    return span;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(checked) {
    super();
    this.checked = checked;
  }
  eq(other) { return other.checked === this.checked; }
  toDOM(view) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-lp-checkbox";
    box.checked = this.checked;
    box.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const pos = view.posAtDOM(box);
      const marker = view.state.doc.sliceString(pos, pos + 3);
      if (!/^\[[ xX]\]$/.test(marker)) return;
      view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: this.checked ? " " : "x" } });
    });
    return box;
  }
  ignoreEvent() { return true; }
}

class RuleWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-lp-hr";
    return span;
  }
}

const hidden = Decoration.replace({});
const mark = (className) => Decoration.mark({ class: className });

// End of a leading --- frontmatter block, which markdown would otherwise read as a heading
const frontmatterEnd = (doc) => {
  if (doc.lines < 2 || doc.line(1).text !== "---") return -1;
  for (let n = 2; n <= doc.lines; n += 1) {
    if (doc.line(n).text === "---") return doc.line(n).to;
  }
  return -1;
};

function buildDecorations(view, optionsRef) {
  const { state } = view;
  const { doc } = state;
  const options = optionsRef.current || {};
  const decorations = [];

  // Lines touched by a selection show their raw Markdown, like Obsidian
  const activeLines = new Set();
  if (view.hasFocus) {
    for (const range of state.selection.ranges) {
      const first = doc.lineAt(range.from).number;
      const last = doc.lineAt(range.to).number;
      for (let n = first; n <= last; n += 1) activeLines.add(n);
    }
  }
  const isActive = (from, to) => {
    const first = doc.lineAt(from).number;
    const last = doc.lineAt(to).number;
    for (let n = first; n <= last; n += 1) if (activeLines.has(n)) return true;
    return false;
  };
  const eachLine = (from, to, className) => {
    for (let n = doc.lineAt(from).number; n <= doc.lineAt(to).number; n += 1) {
      decorations.push(Decoration.line({ class: className }).range(doc.line(n).from));
    }
  };
  // Also swallows the space after markers like "#" and ">"
  const hideWithSpace = (from, to) => {
    const end = doc.sliceString(to, to + 1) === " " ? to + 1 : to;
    decorations.push(hidden.range(from, end));
  };

  const fmEnd = frontmatterEnd(doc);
  if (fmEnd > 0) eachLine(0, fmEnd, "cm-lp-frontmatter");

  syntaxTree(state).iterate({
    enter(node) {
      if (fmEnd > 0 && node.to <= fmEnd) return node.name === "Document" ? undefined : false;
      const { from, to, name } = node;

      const heading = /^ATXHeading(\d)$/.exec(name);
      if (heading) {
        eachLine(from, to, `cm-lp-h${heading[1]}`);
        return undefined;
      }
      const setext = /^SetextHeading(\d)$/.exec(name);
      if (setext) {
        decorations.push(Decoration.line({ class: `cm-lp-h${setext[1]}` }).range(doc.lineAt(from).from));
        return undefined;
      }

      switch (name) {
        case "HeaderMark":
          if (node.node.parent?.name.startsWith("ATXHeading") && !isActive(from, to)) hideWithSpace(from, to);
          return undefined;
        case "Emphasis":
          decorations.push(mark("cm-lp-em").range(from, to));
          return undefined;
        case "StrongEmphasis":
          // The rendered view treats __text__ as underline rather than bold
          decorations.push(mark(doc.sliceString(from, from + 2) === "__" ? "cm-lp-u" : "cm-lp-strong").range(from, to));
          return undefined;
        case "Strikethrough":
          decorations.push(mark("cm-lp-strike").range(from, to));
          return undefined;
        case "Highlight":
          decorations.push(mark("cm-lp-mark").range(from, to));
          return undefined;
        case "EmphasisMark":
        case "StrikethroughMark":
        case "HighlightMark":
          if (!isActive(from, to)) decorations.push(hidden.range(from, to));
          return undefined;
        case "InlineCode":
          decorations.push(mark("cm-lp-code").range(from, to));
          return undefined;
        case "CodeMark":
          if (node.node.parent?.name === "InlineCode" && !isActive(from, to)) decorations.push(hidden.range(from, to));
          return undefined;
        case "FencedCode":
        case "CodeBlock":
          eachLine(from, to, "cm-lp-codeblock");
          return false;
        case "Blockquote":
          eachLine(from, to, "cm-lp-quote");
          return undefined;
        case "QuoteMark":
          if (!isActive(from, to)) hideWithSpace(from, to);
          return undefined;
        case "HorizontalRule":
          if (!isActive(from, to)) decorations.push(Decoration.replace({ widget: new RuleWidget() }).range(from, to));
          return false;
        case "ListMark": {
          const item = node.node.parent;
          if (item?.parent?.name !== "BulletList" || isActive(from, to)) return undefined;
          // Task items show only their checkbox, like Obsidian
          if (item.getChild("Task")) hideWithSpace(from, to);
          else decorations.push(Decoration.replace({ widget: new BulletWidget() }).range(from, to));
          return undefined;
        }
        case "TaskMarker": {
          if (isActive(from, to)) return undefined;
          const checked = /x/i.test(doc.sliceString(from, to));
          decorations.push(Decoration.replace({ widget: new CheckboxWidget(checked) }).range(from, to));
          if (checked) eachLine(from, to, "cm-lp-task-done");
          return undefined;
        }
        case "Link": {
          const marks = node.node.getChildren("LinkMark");
          if (marks.length < 2 || doc.sliceString(marks[1].from, marks[1].from + 2) !== "](") return undefined;
          if (marks[0].to < marks[1].from) decorations.push(mark("cm-lp-link").range(marks[0].to, marks[1].from));
          if (!isActive(from, to)) {
            decorations.push(hidden.range(from, marks[0].to));
            decorations.push(hidden.range(marks[1].from, to));
          }
          return undefined;
        }
        case "Image": {
          if (isActive(from, to)) return false;
          const url = node.node.getChild("URL");
          const src = url ? options.resolveImageSrc?.(doc.sliceString(url.from, url.to)) : null;
          if (src) {
            const marks = node.node.getChildren("LinkMark");
            const alt = marks.length >= 2 ? doc.sliceString(marks[0].to, marks[1].from) : "";
            decorations.push(Decoration.replace({ widget: new ImageWidget(src, alt) }).range(from, to));
          }
          return false;
        }
        case "WikiLink": {
          const raw = doc.sliceString(from, to);
          const embed = raw.startsWith("!");
          const open = from + (embed ? 3 : 2);
          const inner = raw.slice(embed ? 3 : 2, -2);
          const { target, alias } = parseWikilink(inner);
          if (!target) return false;
          const active = isActive(from, to);

          if (embed && IMAGE_EXT_RE.test(target)) {
            const src = !active ? options.resolveImageSrc?.(target) : null;
            if (src) decorations.push(Decoration.replace({ widget: new ImageWidget(src, alias || target) }).range(from, to));
            return false;
          }

          const notePath = options.resolveWikilink?.(target) || "";
          const linkMark = Decoration.mark({
            class: `cm-lp-wikilink${notePath ? "" : " is-unresolved"}`,
            attributes: { "data-note-target": target, "data-note-path": notePath },
          });
          const pipe = inner.indexOf("|");
          if (active) {
            decorations.push(linkMark.range(open, to - 2));
          } else {
            decorations.push(hidden.range(from, open));
            const textFrom = pipe === -1 ? open : open + pipe + 1;
            if (textFrom > open) decorations.push(hidden.range(open, textFrom));
            if (textFrom < to - 2) decorations.push(linkMark.range(textFrom, to - 2));
            decorations.push(hidden.range(to - 2, to));
          }
          return false;
        }
        default:
          return undefined;
      }
    },
  });

  return Decoration.set(decorations, true);
}

// optionsRef.current: { resolveWikilink(target), resolveImageSrc(src), onOpenWikilink({ notePath, target }) }
export function livePreview(optionsRef) {
  const plugin = ViewPlugin.fromClass(class {
    constructor(view) {
      this.decorations = buildDecorations(view, optionsRef);
    }
    update(update) {
      const refreshed = update.transactions.some((tr) => tr.effects.some((effect) => effect.is(refreshLivePreview)));
      if (
        update.docChanged || update.selectionSet || update.focusChanged || update.viewportChanged || refreshed
        || syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = buildDecorations(update.view, optionsRef);
      }
    }
  }, { decorations: (instance) => instance.decorations });

  // Ctrl/Cmd+click follows a wikilink; a plain click places the cursor to edit it
  const linkClicks = EditorView.domEventHandlers({
    mousedown(event) {
      if (!(event.ctrlKey || event.metaKey)) return false;
      const link = event.target.closest?.(".cm-lp-wikilink");
      if (!link) return false;
      event.preventDefault();
      optionsRef.current?.onOpenWikilink?.({
        notePath: link.getAttribute("data-note-path") || null,
        target: link.getAttribute("data-note-target"),
      });
      return true;
    },
  });

  return [noteMarkdown, plugin, linkClicks];
}
