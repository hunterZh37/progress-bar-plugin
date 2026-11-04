"use strict";
// Pure helpers: no `$`, so tests import them directly.
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.shQuote = exports.bar = exports.ago = exports.slug = exports.FRESH_MS = exports.MAX_LINES = exports.expandHome = void 0;
exports.parseWatch = parseWatch;
exports.readLog = readLog;
exports.eta = eta;
exports.parseProgress = parseProgress;
exports.line = line;
exports.lines = lines;
exports.prevOf = prevOf;
exports.statusScript = statusScript;
exports.todoItems = todoItems;
exports.todoList = todoList;
exports.todoAdd = todoAdd;
exports.todoDone = todoDone;
exports.todoClear = todoClear;
var str = function (v) { return (typeof v === 'string' && v ? v : undefined); };
/** Parses a watch file's text; null when it is not usable (no log, no way to count, or a bad regex). */
function parseWatch(text) {
    try {
        var w = JSON.parse(text);
        if (!w || typeof w !== 'object' || !str(w.log))
            return null;
        var total = typeof w.total === 'number' && w.total > 0 ? w.total : undefined;
        if (!str(w.match) && !(str(w.count) && total))
            return null;
        for (var _i = 0, _a = ['match', 'count', 'step', 'error']; _i < _a.length; _i++) {
            var k = _a[_i];
            if (str(w[k]))
                new RegExp(w[k]);
        }
        return {
            log: w.log, label: str(w.label), match: str(w.match), count: str(w.count),
            total: total,
            step: str(w.step), error: str(w.error), process: str(w.process),
            startedAt: typeof w.startedAt === 'number' ? w.startedAt : undefined,
        };
    }
    catch (_b) {
        return null;
    }
}
var lastMatch = function (re, text) {
    var last = null;
    for (var _i = 0, _a = text.matchAll(new RegExp(re, 'gm')); _i < _a.length; _i++) {
        var m = _a[_i];
        last = m;
    }
    return last;
};
/** Reads progress out of a log's text by the watch's patterns. */
function readLog(w, text) {
    var _a;
    var done = null;
    var total = null;
    if (w.match) {
        var m = lastMatch(w.match, text);
        if (m && m[1] !== undefined && m[2] !== undefined) {
            var d = Number(m[1]), t = Number(m[2]);
            if (Number.isFinite(d) && Number.isFinite(t) && t > 0) {
                done = d;
                total = t;
            }
        }
    }
    else if (w.count && w.total) {
        done = Math.min(__spreadArray([], text.matchAll(new RegExp(w.count, 'gm')), true).length, w.total);
        total = w.total;
    }
    var s = w.step ? lastMatch(w.step, text) : null;
    var step = s ? ((_a = s[1]) !== null && _a !== void 0 ? _a : s[0]).trim().slice(0, 60) : '';
    var error = !!w.error && new RegExp(w.error, 'm').test(text);
    return { done: done, total: total, step: step, error: error };
}
/** Time left at the rate so far, or '' when it can't be told yet. */
function eta(elapsedMs, done, total) {
    if (done === null || total === null || done <= 0 || done >= total || elapsedMs <= 0)
        return '';
    return (0, exports.ago)((elapsedMs / done) * (total - done));
}
/** Expands a leading `~/` to the home folder. */
var expandHome = function (p, home) { return (p === '~' ? home : p.startsWith('~/') ? home + p.slice(1) : p); };
exports.expandHome = expandHome;
exports.MAX_LINES = 6;
exports.FRESH_MS = 10 * 60000;
/** "Fix the Login bug!" -> "fix-the-login-bug" */
var slug = function (s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); };
exports.slug = slug;
var ago = function (ms) {
    var m = Math.max(0, Math.round(ms / 60000));
    return m < 60 ? "".concat(m, "m") : "".concat(Math.floor(m / 60), "h").concat(String(m % 60).padStart(2, '0'), "m");
};
exports.ago = ago;
var bar = function (frac, w) {
    if (w === void 0) { w = 20; }
    var f = Math.round(Math.max(0, Math.min(1, frac)) * w);
    return '█'.repeat(f) + '░'.repeat(w - f);
};
exports.bar = bar;
/** Parses a progress file's text; null when it is not usable JSON. */
function parseProgress(text) {
    try {
        var p = JSON.parse(text);
        if (!p || typeof p !== 'object')
            return null;
        var ok = typeof p.done === 'number' && typeof p.total === 'number' && p.total > 0;
        return {
            done: ok ? p.done : null,
            total: ok ? p.total : null,
            step: typeof p.step === 'string' ? p.step : '',
            startedAt: typeof p.startedAt === 'number' ? p.startedAt : undefined,
        };
    }
    catch (_a) {
        return null;
    }
}
/** One status-line row: `▶ name ████████░░░░░░░░░░░░ 40.0% · 2/5 · step · 3m`. */
function line(r, now) {
    var tools = r.id.startsWith('file:') || r.id.startsWith('watch:') ? '' : " \u00B7 ".concat(r.tools, " tools");
    var meta = " \u00B7 ".concat((0, exports.ago)(now - r.startedAt)).concat(tools);
    var step = r.step ? " \u00B7 ".concat(r.step) : '';
    var mark = r.state === 'done' ? '✔' : r.state === 'stopped' ? '■ stopped' : r.state === 'error' ? '✖ error' : '▶';
    var left = r.eta && r.state !== 'done' ? " \u00B7 ETA ".concat(r.eta) : '';
    if (r.done !== null && r.total !== null) {
        var frac = r.done / r.total;
        return "".concat(mark, " ").concat(r.description, " ").concat((0, exports.bar)(frac), " ").concat((frac * 100).toFixed(1), "% \u00B7 ").concat(r.done, "/").concat(r.total).concat(step).concat(meta).concat(left);
    }
    if (r.state && r.state !== 'running')
        return "".concat(mark, " ").concat(r.description).concat(step).concat(meta);
    var state = r.status === 'running' ? 'working' : r.status;
    return "\u25B6 ".concat(r.description, " ").concat(state).concat(step).concat(meta).concat(r.lastTool ? " \u00B7 ".concat(r.lastTool) : '');
}
/** Rendered lines, capped; the overflow is summed up on the last line. */
function lines(rows, now, max) {
    if (max === void 0) { max = exports.MAX_LINES; }
    var out = rows.slice(0, max).map(function (r) { return line(r, now); });
    if (rows.length > max)
        out[max - 1] = "\u2026 ".concat(rows.length - max + 1, " more");
    return out;
}
/** Quotes a string for POSIX sh inside single quotes. */
var shQuote = function (s) { return "'".concat(s.replace(/'/g, "'\\''"), "'"); };
exports.shQuote = shQuote;
/** The chained command inside an installed script (its `prev=` line), so a rewrite keeps it. */
function prevOf(script) {
    var m = /^prev='((?:[^']|'\\'')*)'$/m.exec(script);
    var v = m ? m[1].replace(/'\\''/g, "'") : '';
    return v || undefined;
}
/** The status line script `/progress-bar setup` writes. `prev` is a command to chain after the bars. */
function statusScript(prev) {
    return [
        '#!/bin/sh',
        '# progress-bar status line. Written by `/progress-bar setup`. Safe to edit or delete.',
        '# Prints each fresh (<2 min) ~/.claude-progress/.lines/*.txt, then the previous status line if any,',
        '# grouped into TO-DO / PROBLEMS / RUNNING / WAITING / DONE by group.py beside this script.',
        '# Without python3 the lines print ungrouped.',
        '# While the Status panel is on (~/.claude-progress/.state/panel-on) it prints one summary line,',
        '# unless PB_FULL=1 (the panel itself runs it that way for the full view).',
        'input=$(cat)',
        "prev=".concat((0, exports.shQuote)(prev !== null && prev !== void 0 ? prev : '')),
        'lines() {',
        '  dir="$HOME/.claude-progress/.lines"',
        '  for f in "$dir"/*.txt; do',
        '    [ -s "$f" ] || continue',
        '    [ -n "$(find "$f" -mmin -2 2>/dev/null)" ] || continue',
        '    cat "$f"; echo',
        '  done',
        '  if [ -n "$prev" ]; then printf \'%s\' "$input" | sh -c "$prev"; fi',
        '}',
        'group="$HOME/.claude/progress-bar/group.py"',
        'if [ -f "$group" ] && command -v python3 >/dev/null 2>&1; then',
        '  out=$(lines)',
        '  mode=',
        '  if [ -f "$HOME/.claude-progress/.state/panel-on" ] && [ "$PB_FULL" != 1 ]; then mode=--summary; fi',
        '  printf \'%s\\n\' "$out" | python3 "$group" $mode 2>/dev/null || printf \'%s\\n\' "$out"',
        'else',
        '  lines',
        'fi',
        '',
    ].join('\n');
}
var HEADING = /^\[(.+)\]$/;
var TODO_HEADER = '# To-dos shown in the status line. One per line under a [name] heading. "x " marks done. "text | url" links.\n';
/** Every to-do item in file order, numbered from 1. Items before any heading go under `todo`. */
function todoItems(text) {
    var out = [];
    var heading = 'todo';
    text.split('\n').forEach(function (raw, i) {
        var t = raw.trim();
        if (!t || t.startsWith('#'))
            return;
        var m = HEADING.exec(t);
        if (m) {
            heading = m[1].trim();
            return;
        }
        var done = /^x\s/i.test(t);
        out.push({ index: out.length + 1, heading: heading, text: done ? t.slice(2).trim() : t, done: done, line: i });
    });
    return out;
}
/** Numbered list for `/progress-bar todo`. */
function todoList(text) {
    var items = todoItems(text);
    if (!items.length)
        return 'No to-dos. Add one: /progress-bar todo add [name] <text>';
    var out = [];
    var cur = '';
    for (var _i = 0, items_1 = items; _i < items_1.length; _i++) {
        var it = items_1[_i];
        if (it.heading !== cur) {
            cur = it.heading;
            out.push("[".concat(cur, "]"));
        }
        out.push("  ".concat(it.index, ". ").concat(it.done ? '[x] ' : '').concat(it.text));
    }
    return out.join('\n');
}
var headings = function (lines) { return lines.map(function (l) { var _a, _b; return (_b = (_a = HEADING.exec(l.trim())) === null || _a === void 0 ? void 0 : _a[1]) === null || _b === void 0 ? void 0 : _b.trim(); }).filter(function (h) { return !!h; }); };
/**
 * Adds an item. `rest` is `[name] text`, `name text` when name is an existing heading, or `text`
 * (under the last heading in the file, or [todo]).
 */
function todoAdd(text, rest) {
    var _a;
    var lines = text ? text.replace(/\n+$/, '').split('\n') : TODO_HEADER.trimEnd().split('\n');
    var known = headings(lines);
    var heading;
    var item = rest.trim();
    var br = /^\[([^\]]+)\]\s*(.*)$/.exec(item);
    if (br) {
        heading = br[1].trim();
        item = br[2].trim();
    }
    else {
        var _b = item.split(/\s+/), _c = _b[0], first_1 = _c === void 0 ? '' : _c, more = _b.slice(1);
        var hit = known.find(function (h) { return h.toLowerCase() === first_1.toLowerCase(); });
        if (hit && more.length) {
            heading = hit;
            item = item.slice(first_1.length).trim();
        }
    }
    heading !== null && heading !== void 0 ? heading : (heading = (_a = known[known.length - 1]) !== null && _a !== void 0 ? _a : 'todo');
    var at = lines.findIndex(function (l) { return l.trim().toLowerCase() === "[".concat(heading.toLowerCase(), "]"); });
    if (at < 0) {
        lines.push("[".concat(heading, "]"), item);
    }
    else {
        var end = at + 1;
        while (end < lines.length && !HEADING.test(lines[end].trim()))
            end++;
        while (end > at + 1 && !lines[end - 1].trim())
            end--;
        lines.splice(end, 0, item);
    }
    return { text: lines.join('\n') + '\n', heading: heading };
}
/** Marks an item done by its number or by text it contains (first open match). Null when nothing matches. */
function todoDone(text, which) {
    var items = todoItems(text);
    var w = which.trim();
    var item = /^\d+$/.test(w)
        ? items.find(function (i) { return i.index === Number(w); })
        : items.find(function (i) { return !i.done && i.text.toLowerCase().includes(w.toLowerCase()); });
    if (!item || !w)
        return null;
    var lines = text.split('\n');
    if (!item.done)
        lines[item.line] = "x ".concat(lines[item.line].trim());
    return { text: lines.join('\n'), item: item };
}
/** Removes done items, and headings left with no items. */
function todoClear(text) {
    var lines = text.split('\n');
    var keep = [];
    var removed = 0;
    for (var _i = 0, lines_1 = lines; _i < lines_1.length; _i++) {
        var l = lines_1[_i];
        if (/^x\s/i.test(l.trim())) {
            removed++;
            continue;
        }
        keep.push(l);
    }
    var out = keep.filter(function (l, i) {
        if (!HEADING.test(l.trim()))
            return true;
        for (var j = i + 1; j < keep.length; j++) {
            var t = keep[j].trim();
            if (HEADING.test(t))
                return false;
            if (t && !t.startsWith('#'))
                return true;
        }
        return false;
    });
    return { text: out.join('\n'), removed: removed };
}
