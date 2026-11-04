"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
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
exports.shortAge = exports.stripAnsi = exports.SECTION_KEYS = exports.PANEL_FLAG_REL = exports.PANE = void 0;
exports.parseSections = parseSections;
exports.todoItems = todoItems;
exports.runningRow = runningRow;
exports.todoAction = todoAction;
exports.pollPanel = pollPanel;
exports.openPanel = openPanel;
exports.isPanelOn = isPanelOn;
exports.panelCommand = panelCommand;
exports.startPanel = startPanel;
exports.registerPanel = registerPanel;
var claude_code_1 = require("claude-code");
var connectors_1 = require("./connectors");
var github_1 = require("./github");
var home_1 = require("./home");
var render_1 = require("./render");
// The Status panel: the grouped status line, drawn in a docked pane beside the chat.
// It runs the plugin's own status line script with PB_FULL=1 every second while the pane is open.
// Section headers are buttons that fold or open the section through ~/.claude-progress/.state/folded.txt.
// To-dos come straight from ~/.claude-progress/todo.txt: open ones under TO-DO, checked-off ones under DONE.
// Pressing one opens a menu: mark as done (or move back to to-do) or delete.
// Three tabs: List (the sections), Connectors (see connectors.ts) and GitHub (see github.ts).
// Connector checks run only while the pane is open; GitHub reads only while its tab shows.
exports.PANE = 'progress-bar-status';
var TITLE = 'Status';
var COLUMNS = 52;
var SCRIPT_REL = '.claude/progress-bar/statusline.sh';
exports.PANEL_FLAG_REL = '.claude-progress/.state/panel-on';
var FOLDED_REL = '.claude-progress/.state/folded.txt';
var TODO_REL = '.claude-progress/todo.txt';
exports.SECTION_KEYS = ['todo', 'running', 'done', 'waiting', 'problems'];
var TITLES = { 'TO-DO': 'todo', RUNNING: 'running', WAITING: 'waiting', DONE: 'done', PROBLEMS: 'problems' };
var HOTKEYS = { todo: '1', running: '2', done: '3', waiting: '4', problems: '5' };
var ICON = { todo: '☐', running: '▶', waiting: '⏸', done: '✔', problems: '✖' };
var foldedAtom = (0, claude_code_1.atom)({ plugin: 'progress-bar', key: 'folded' }, []);
var linesAtom = (0, claude_code_1.atom)({ plugin: 'progress-bar', key: 'lines' }, []);
var todosAtom = (0, claude_code_1.atom)({ plugin: 'progress-bar', key: 'todos' }, []);
var menuAtom = (0, claude_code_1.atom)({ plugin: 'progress-bar', key: 'menuFor' }, -1);
// The same state connectors.ts writes; the scan wants each atom declared in the file that reads it.
var connsAtom = (0, claude_code_1.atom)({ plugin: 'progress-bar', key: 'conns' }, { at: 0, checking: false, login: '', list: [] });
var tabAtom = (0, claude_code_1.atom)({ plugin: 'progress-bar', key: 'tab' }, 'list');
var ghAtom = (0, claude_code_1.atom)({ plugin: 'progress-bar', key: 'gh' }, { repos: [], sel: 0, at: 0 });
/** Removes terminal colors and OSC 8 links. */
var stripAnsi = function (s) {
    return s.replace(/\x1b\]8;;[^\x07\x1b]*(\x07|\x1b\\)/g, '').replace(/\x1b\[[0-9;]*m/g, '');
};
exports.stripAnsi = stripAnsi;
/** Splits the grouped output into sections (a header, then its indented rows) and the lines after them. */
function parseSections(lines) {
    var _a;
    var sections = [];
    var other = [];
    for (var _i = 0, lines_1 = lines; _i < lines_1.length; _i++) {
        var line = lines_1[_i];
        var head = /^([▾▸])\s+\S+\s+(TO-DO|RUNNING|WAITING|DONE|PROBLEMS)(?:\s+\((\d+)\))?\s*$/.exec(line);
        if (head) {
            sections.push({ key: TITLES[head[2]], title: head[2], folded: head[1] === '▸', count: Number((_a = head[3]) !== null && _a !== void 0 ? _a : 0), rows: [] });
            continue;
        }
        var last = sections[sections.length - 1];
        if (last && /^\s/.test(line))
            last.rows.push(line.trim());
        else
            other.push(line.trim());
    }
    for (var _b = 0, sections_1 = sections; _b < sections_1.length; _b++) {
        var s = sections_1[_b];
        if (s.folded)
            continue;
        s.count = s.key === 'todo' ? s.rows.reduce(function (a, r) { return a + todoItems(r).items.length; }, 0) : s.rows.length;
    }
    return { sections: sections, other: other };
}
/** "YOU: a · b" -> { who: 'You', items: ['a', 'b'] } */
function todoItems(row) {
    var m = /^([A-Z][A-Z0-9 _-]*):\s*(.*)$/.exec(row);
    var who = m ? m[1].charAt(0) + m[1].slice(1).toLowerCase() : '';
    return { who: who, items: (m ? m[2] : row).split(' · ').map(function (s) { return s.trim(); }).filter(Boolean) };
}
/** A running row: its mark, name, percent and the remaining details. */
function runningRow(row) {
    var _a, _b;
    var stuck = /^⚠ stuck (\S+)\s*/.exec(row);
    var spin = /^([◐◓◑◒])\s*/.exec(row);
    var clean = row.slice((_b = (_a = (stuck !== null && stuck !== void 0 ? stuck : spin)) === null || _a === void 0 ? void 0 : _a[0].length) !== null && _b !== void 0 ? _b : 0);
    var name = clean.split(/\s+[█░]|\s+·\s+/)[0].trim();
    var pctM = /(\d+(?:\.\d+)?)%/.exec(clean);
    var details = clean.slice(name.length).replace(/^[\s█░]+/, '').split(' · ').map(function (p) { return p.trim(); }).filter(function (p) { return p && !/^\d+(\.\d+)?%$/.test(p); }).join(' · ');
    return { mark: stuck ? "\u26A0 ".concat(stuck[1]) : spin ? spin[1] : '•', stuck: !!stuck, name: name, pct: pctM ? Number(pctM[1]) : null, details: details };
}
function readFolded($, h) {
    return __awaiter(this, void 0, void 0, function () {
        var keys, _a, _b, prev;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    keys = [];
                    _c.label = 1;
                case 1:
                    _c.trys.push([1, 3, , 4]);
                    _a = String;
                    return [4 /*yield*/, $.fs.read("".concat(h, "/").concat(FOLDED_REL))];
                case 2:
                    keys = _a.apply(void 0, [_c.sent()]).split(/\s+/).filter(Boolean);
                    return [3 /*break*/, 4];
                case 3:
                    _b = _c.sent();
                    keys = [];
                    return [3 /*break*/, 4];
                case 4: return [4 /*yield*/, (0, claude_code_1.read)($, foldedAtom)];
                case 5:
                    prev = _c.sent();
                    if (!(prev.join() !== keys.join())) return [3 /*break*/, 7];
                    return [4 /*yield*/, (0, claude_code_1.update)($, foldedAtom, function () { return keys; })];
                case 6:
                    _c.sent();
                    _c.label = 7;
                case 7: return [2 /*return*/, keys];
            }
        });
    });
}
/** Reads todo.txt into the to-dos atom, done ones included. */
function readTodos($, h) {
    return __awaiter(this, void 0, void 0, function () {
        var raw, _a, _b, out, prev;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    raw = '';
                    _c.label = 1;
                case 1:
                    _c.trys.push([1, 3, , 4]);
                    _a = String;
                    return [4 /*yield*/, $.fs.read("".concat(h, "/").concat(TODO_REL))];
                case 2:
                    raw = _a.apply(void 0, [_c.sent()]);
                    return [3 /*break*/, 4];
                case 3:
                    _b = _c.sent();
                    raw = '';
                    return [3 /*break*/, 4];
                case 4:
                    out = (0, render_1.todoItems)(raw).map(function (t) { return ({ owner: t.heading, text: t.text.split(' | ')[0].trim(), done: t.done, line: t.line }); });
                    return [4 /*yield*/, (0, claude_code_1.read)($, todosAtom)];
                case 5:
                    prev = _c.sent();
                    if (!(JSON.stringify(prev) !== JSON.stringify(out))) return [3 /*break*/, 7];
                    return [4 /*yield*/, (0, claude_code_1.update)($, todosAtom, function () { return out; })];
                case 6:
                    _c.sent();
                    _c.label = 7;
                case 7: return [2 /*return*/];
            }
        });
    });
}
/** "3 weeks" -> "3w", "2 hours" -> "2h", "4 months" -> "4mo": a commit's age, short. */
var shortAge = function (w) {
    var m = /^(\d+) (\w+)/.exec(w);
    if (!m)
        return w;
    return "".concat(m[1]).concat(m[2].startsWith('mo') ? 'mo' : m[2].charAt(0));
};
exports.shortAge = shortAge;
/** A todo.txt line's item text: no "x " mark, no " | link". */
var itemText = function (l) { return l.trim().replace(/^x\s+/i, '').split(' | ')[0].trim(); };
/**
 * One menu action on a to-do: mark done, mark to-do (reopen) or delete.
 * Acts on the line that still holds the item's text: the file can change between drawing and the press
 * (another session adds a line), so the line number alone could hit the wrong item.
 */
function todoAction($_1, h_1, line_1, action_1) {
    return __awaiter(this, arguments, void 0, function ($, h, line, action, text) {
        var file, lines, _a, same, body, _b;
        if (text === void 0) { text = ''; }
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    file = "".concat(h, "/").concat(TODO_REL);
                    _c.label = 1;
                case 1:
                    _c.trys.push([1, 5, , 6]);
                    _a = String;
                    return [4 /*yield*/, $.fs.read(file)];
                case 2:
                    lines = _a.apply(void 0, [_c.sent()]).split('\n');
                    same = function (l) { return itemText(l) === text.trim(); };
                    if (text && !(line < lines.length && same(lines[line])))
                        line = lines.findIndex(same);
                    if (!(line >= 0 && line < lines.length)) return [3 /*break*/, 4];
                    body = lines[line].trim().replace(/^x\s+/i, '');
                    if (action === 'delete')
                        lines.splice(line, 1);
                    else
                        lines[line] = action === 'done' ? "x ".concat(body) : body;
                    return [4 /*yield*/, $.fs.write(file, lines.join('\n'))];
                case 3:
                    _c.sent();
                    _c.label = 4;
                case 4: return [3 /*break*/, 6];
                case 5:
                    _b = _c.sent();
                    return [3 /*break*/, 6];
                case 6: return [4 /*yield*/, (0, claude_code_1.update)($, menuAtom, function () { return -1; })];
                case 7:
                    _c.sent();
                    return [4 /*yield*/, pollPanel($, h)];
                case 8:
                    _c.sent();
                    return [2 /*return*/];
            }
        });
    });
}
/** Runs the status line script in full and keeps its lines. */
function pollPanel($, h) {
    return __awaiter(this, void 0, void 0, function () {
        var stdout, lines_2, prev, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (!h)
                        return [2 /*return*/];
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 6, , 7]);
                    return [4 /*yield*/, $.process.run(['/bin/sh', "".concat(h, "/").concat(SCRIPT_REL)], { stdin: '{}', env: { PB_FULL: '1' }, timeoutMs: 8000 })];
                case 2:
                    stdout = (_b.sent()).stdout;
                    lines_2 = (0, exports.stripAnsi)(stdout).split('\n').filter(function (l) { return l.trim(); });
                    return [4 /*yield*/, (0, claude_code_1.read)($, linesAtom)];
                case 3:
                    prev = _b.sent();
                    if (!(prev.join('\n') !== lines_2.join('\n'))) return [3 /*break*/, 5];
                    return [4 /*yield*/, (0, claude_code_1.update)($, linesAtom, function () { return lines_2; })];
                case 4:
                    _b.sent();
                    _b.label = 5;
                case 5: return [3 /*break*/, 7];
                case 6:
                    _a = _b.sent();
                    return [3 /*break*/, 7];
                case 7: return [4 /*yield*/, readFolded($, h)];
                case 8:
                    _b.sent();
                    return [4 /*yield*/, readTodos($, h)];
                case 9:
                    _b.sent();
                    return [4 /*yield*/, (0, connectors_1.readConns)($, h)];
                case 10:
                    _b.sent();
                    void (0, connectors_1.refreshConns)($, h);
                    return [2 /*return*/];
            }
        });
    });
}
function flip($, h, key) {
    return __awaiter(this, void 0, void 0, function () {
        var cur, _a, _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    _a = Set.bind;
                    return [4 /*yield*/, readFolded($, h)];
                case 1:
                    cur = new (_a.apply(Set, [void 0, _c.sent()]))();
                    if (cur.has(key))
                        cur.delete(key);
                    else
                        cur.add(key);
                    _c.label = 2;
                case 2:
                    _c.trys.push([2, 4, , 5]);
                    return [4 /*yield*/, $.fs.write("".concat(h, "/").concat(FOLDED_REL), __spreadArray([], cur, true).join('\n'))];
                case 3:
                    _c.sent();
                    return [3 /*break*/, 5];
                case 4:
                    _b = _c.sent();
                    return [3 /*break*/, 5];
                case 5: return [4 /*yield*/, (0, claude_code_1.update)($, foldedAtom, function () { return __spreadArray([], cur, true); })];
                case 6:
                    _c.sent();
                    return [4 /*yield*/, pollPanel($, h)];
                case 7:
                    _c.sent();
                    return [2 /*return*/];
            }
        });
    });
}
function openPanel($) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, $.ui.open({ id: exports.PANE, title: TITLE, columns: COLUMNS })];
        });
    });
}
function isPanelOn($, h) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, h ? $.fs.exists("".concat(h, "/").concat(exports.PANEL_FLAG_REL)).catch(function () { return false; }) : false];
        });
    });
}
/** `/progress-bar panel [on|off]`. */
function panelCommand($, h, arg) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!h)
                        return [2 /*return*/, 'Could not find your home folder ($HOME is unset).'];
                    if (!(arg === 'on')) return [3 /*break*/, 4];
                    return [4 /*yield*/, $.fs.write("".concat(h, "/").concat(exports.PANEL_FLAG_REL), 'on\n')];
                case 1:
                    _a.sent();
                    return [4 /*yield*/, pollPanel($, h)];
                case 2:
                    _a.sent();
                    return [4 /*yield*/, openPanel($)];
                case 3:
                    _a.sent();
                    return [2 /*return*/, 'Status panel on: it opens at session start, and the status line shows one summary line.'];
                case 4:
                    if (!(arg === 'off')) return [3 /*break*/, 7];
                    return [4 /*yield*/, $.process.run(['rm', '-f', "".concat(h, "/").concat(exports.PANEL_FLAG_REL)]).catch(function () { return undefined; })];
                case 5:
                    _a.sent();
                    return [4 /*yield*/, $.ui.close({ id: exports.PANE }).catch(function () { return undefined; })];
                case 6:
                    _a.sent();
                    return [2 /*return*/, 'Status panel off: the status line shows the full groups again.'];
                case 7:
                    if (arg)
                        return [2 /*return*/, 'Usage: /progress-bar panel [on | off]'];
                    return [4 /*yield*/, pollPanel($, h)];
                case 8:
                    _a.sent();
                    return [4 /*yield*/, openPanel($)];
                case 9:
                    _a.sent();
                    return [4 /*yield*/, isPanelOn($, h)];
                case 10: return [2 /*return*/, (_a.sent())
                        ? 'Status panel opened.'
                        : 'Status panel opened. `/progress-bar panel on` opens it at every session start.'];
            }
        });
    });
}
/** At session start: poll every second while the pane is open, and open it when the panel is on. */
function startPanel($, h) {
    return __awaiter(this, void 0, void 0, function () {
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, (0, connectors_1.resetConns)($)];
                case 1:
                    _a.sent();
                    $.clock.every(1000, function () { return __awaiter(_this, void 0, void 0, function () {
                        var open;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0: return [4 /*yield*/, $.ui.panes().then(function (ps) { return ps.some(function (p) { return p.id === exports.PANE; }); }).catch(function () { return false; })];
                                case 1:
                                    open = _a.sent();
                                    if (!open) return [3 /*break*/, 3];
                                    return [4 /*yield*/, pollPanel($, h)];
                                case 2:
                                    _a.sent();
                                    _a.label = 3;
                                case 3: return [2 /*return*/];
                            }
                        });
                    }); });
                    $.clock.every(github_1.GH_EVERY, function () { return __awaiter(_this, void 0, void 0, function () {
                        var open;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0: return [4 /*yield*/, (0, claude_code_1.read)($, tabAtom)];
                                case 1:
                                    if ((_a.sent()) !== 'github')
                                        return [2 /*return*/];
                                    return [4 /*yield*/, $.ui.panes().then(function (ps) { return ps.some(function (p) { return p.id === exports.PANE; }); }).catch(function () { return false; })];
                                case 2:
                                    open = _a.sent();
                                    if (!open) return [3 /*break*/, 4];
                                    return [4 /*yield*/, (0, github_1.readGh)($, h)];
                                case 3:
                                    _a.sent();
                                    _a.label = 4;
                                case 4: return [2 /*return*/];
                            }
                        });
                    }); });
                    return [4 /*yield*/, isPanelOn($, h)];
                case 2:
                    if (!_a.sent()) return [3 /*break*/, 4];
                    return [4 /*yield*/, pollPanel($, h)];
                case 3:
                    _a.sent();
                    void openPanel($);
                    _a.label = 4;
                case 4: return [2 /*return*/];
            }
        });
    });
}
/** Draws the pane. */
function registerPanel(on) {
    var _this = this;
    on('ui.render', { component: 'Pane', requestId: exports.PANE }, function ($, e) { return __awaiter(_this, void 0, void 0, function () {
        var _a, Box, Button, Text, homeDir, lines, folded, _b, todos, menuFor, conns, tab, openTodos, width, barW, _c, parsed, other, doneTodos, sections, todoItem, todoRows, doneRows, runRows, plainRows, badN, mark, tabBar, gh, n_1, repo_1, _d, _e, owner, _f, slugName, others, msgW_1, cut_1, link_1, hhmm, ordered, COLOR_1, MARK_1, connRow;
        var _this = this;
        var _g, _h;
        return __generator(this, function (_j) {
            switch (_j.label) {
                case 0:
                    _a = $.ui.resolve(e), Box = _a.Box, Button = _a.Button, Text = _a.Text;
                    return [4 /*yield*/, (0, home_1.resolveHome)($)];
                case 1:
                    homeDir = _j.sent();
                    return [4 /*yield*/, (0, claude_code_1.read)($, linesAtom)];
                case 2:
                    lines = _j.sent();
                    _b = Set.bind;
                    return [4 /*yield*/, (0, claude_code_1.read)($, foldedAtom)];
                case 3:
                    folded = new (_b.apply(Set, [void 0, _j.sent()]))();
                    return [4 /*yield*/, (0, claude_code_1.read)($, todosAtom)];
                case 4:
                    todos = _j.sent();
                    return [4 /*yield*/, (0, claude_code_1.read)($, menuAtom)];
                case 5:
                    menuFor = _j.sent();
                    return [4 /*yield*/, (0, claude_code_1.read)($, connsAtom)];
                case 6:
                    conns = _j.sent();
                    return [4 /*yield*/, (0, claude_code_1.read)($, tabAtom)];
                case 7:
                    tab = _j.sent();
                    openTodos = todos.filter(function (t) { return !t.done; }).length;
                    width = Math.max(30, (_g = e.props.bodyColumns) !== null && _g !== void 0 ? _g : 60);
                    barW = Math.min(20, Math.max(10, width - 30));
                    _c = parseSections(lines), parsed = _c.sections, other = _c.other;
                    doneTodos = todos.filter(function (t) { return t.done; });
                    sections = parsed.filter(function (s) { return s.key !== 'todo' || openTodos > 0; });
                    if (openTodos > 0 && !sections.some(function (s) { return s.key === 'todo'; }))
                        sections.unshift({ key: 'todo', title: 'TO-DO', folded: false, count: 0, rows: [] });
                    if (doneTodos.length && !sections.some(function (s) { return s.key === 'done'; }))
                        sections.push({ key: 'done', title: 'DONE', folded: false, count: 0, rows: [] });
                    todoItem = function (t) { return [
                        <Button key={"t-".concat(t.line)} plain onPress={function () { return (0, claude_code_1.update)($, menuAtom, function (v) { return (v === t.line ? -1 : t.line); }); }}>
        {"    ".concat(t.done ? '✓' : '○', " ").concat(t.text)}
      </Button>,
                        menuFor === t.line
                            ? <Box key={"m-".concat(t.line)}>
            <Text dimColor>{'      '}</Text>
            {t.done
                                    ? <Button key={"a-todo-".concat(t.line)} plain onPress={function () { return todoAction($, homeDir, t.line, 'todo', t.text); }}>{'○ Move back to to-do  '}</Button>
                                    : <Button key={"a-done-".concat(t.line)} plain onPress={function () { return todoAction($, homeDir, t.line, 'done', t.text); }}>{'✓ Mark as done  '}</Button>}
            <Button key={"a-del-".concat(t.line)} plain onPress={function () { return todoAction($, homeDir, t.line, 'delete', t.text); }}>{'✕ Delete  '}</Button>
            <Button key={"a-x-".concat(t.line)} plain onPress={function () { return (0, claude_code_1.update)($, menuAtom, function () { return -1; }); }}>{'Cancel'}</Button>
          </Box>
                            : null,
                    ].filter(Boolean); };
                    todoRows = function () { return __spreadArray([], new Set(todos.map(function (t) { return t.owner; })), true).flatMap(function (owner) {
                        var items = todos.filter(function (t) { return t.owner === owner && !t.done; });
                        if (!items.length)
                            return [];
                        return __spreadArray([
                            <Text key={"w-".concat(owner)} bold color="magenta">{"  ".concat(owner.charAt(0).toUpperCase()).concat(owner.slice(1).toLowerCase())}</Text>
                        ], items.flatMap(todoItem), true);
                    }); };
                    doneRows = function (rows) { return __spreadArray(__spreadArray([], plainRows(rows, 'done'), true), (doneTodos.length ? __spreadArray([<Text key="w-checked" bold color="magenta">{'  Checked-off to-dos'}</Text>], doneTodos.flatMap(todoItem), true) : []), true); };
                    runRows = function (rows) { return rows.flatMap(function (row, i) {
                        var r = runningRow(row);
                        var frac = r.pct === null ? null : Math.min(1, r.pct / 100);
                        var filled = frac === null ? 0 : Math.round(frac * barW);
                        return [
                            <Box key={"r".concat(i)}>
          <Text color={r.stuck ? 'yellow' : 'cyan'}>{"  ".concat(r.mark, " ")}</Text>
          <Text bold color={r.stuck ? 'yellow' : undefined}>{r.name}</Text>
        </Box>,
                            frac !== null
                                ? <Box key={"b".concat(i)}>
              <Text color="green">{"    ".concat('█'.repeat(filled))}</Text>
              <Text dimColor>{'░'.repeat(barW - filled)}</Text>
              <Text bold>{" ".concat(r.pct, "%")}</Text>
            </Box>
                                : null,
                            r.details ? <Text key={"d".concat(i)} dimColor>{"    ".concat(r.details)}</Text> : null,
                        ].filter(Boolean);
                    }); };
                    plainRows = function (rows, key) { return rows.map(function (row, i) {
                        var fin = /^(.*?) · finished (\d\d:\d\d)$/.exec(row);
                        if (fin)
                            return <Text key={"p".concat(i)} dimColor>{"  \u2713 ".concat(fin[1], "  ").concat(fin[2])}</Text>;
                        return <Text key={"p".concat(i)} color={key === 'problems' ? 'red' : undefined} dimColor={key === 'done'}>{"  ".concat(row)}</Text>;
                    }); };
                    badN = conns.list.filter(function (c) { return c.kind !== 'ok'; }).length;
                    mark = function (t) { return (tab === t ? '▌' : ' '); };
                    tabBar = (<Box key="tabs" marginBottom={1}>
        <Button key="tab-list" plain onPress={function () { return (0, claude_code_1.update)($, tabAtom, function () { return 'list'; }); }}>{"".concat(mark('list'), "List")}</Button>
        <Text dimColor>{'  │  '}</Text>
        <Button key="tab-connectors" plain onPress={function () { return (0, claude_code_1.update)($, tabAtom, function () { return 'connectors'; }); }}>{"".concat(mark('connectors'), "Connectors").concat(badN ? " !".concat(badN) : '')}</Button>
        <Text dimColor>{'  │  '}</Text>
        <Button key="tab-github" plain onPress={function () { return __awaiter(_this, void 0, void 0, function () { return __generator(this, function (_a) {
                        switch (_a.label) {
                            case 0: return [4 /*yield*/, (0, claude_code_1.update)($, tabAtom, function () { return 'github'; })];
                            case 1:
                                _a.sent();
                                return [4 /*yield*/, (0, github_1.readGh)($, homeDir)];
                            case 2:
                                _a.sent();
                                return [2 /*return*/];
                        }
                    }); }); }}>{"".concat(mark('github'), "GitHub")}</Button>
      </Box>);
                    if (!(tab === 'github')) return [3 /*break*/, 9];
                    return [4 /*yield*/, (0, claude_code_1.read)($, ghAtom)];
                case 8:
                    gh = _j.sent();
                    n_1 = gh.repos.length;
                    repo_1 = gh.repos[gh.sel];
                    _d = (repo_1 === null || repo_1 === void 0 ? void 0 : repo_1.url) ? repo_1.url.replace('https://github.com/', '').split('/') : [], _e = _d[0], owner = _e === void 0 ? '' : _e, _f = _d[1], slugName = _f === void 0 ? '' : _f;
                    others = repo_1 ? repo_1.branches.filter(function (b) { return !b.current; }) : [];
                    msgW_1 = Math.max(16, width - 8);
                    cut_1 = function (s) { return (s.length > msgW_1 ? "".concat(s.slice(0, msgW_1 - 1), "\u2026") : s); };
                    link_1 = function (path) { return ((repo_1 === null || repo_1 === void 0 ? void 0 : repo_1.url) ? "".concat(repo_1.url).concat(path) : ''); };
                    return [2 /*return*/, (<Box flexDirection="column">
          {tabBar}
          {n_1 > 1 && (<Box key="repo-pick" marginBottom={1}>
              <Button key="repo-prev" plain onPress={function () { return (0, claude_code_1.update)($, ghAtom, function (g) { return (__assign(__assign({}, g), { sel: (g.sel - 1 + n_1) % n_1 })); }); }}>{'‹  '}</Button>
              <Text dimColor>{"repo ".concat(gh.sel + 1, " of ").concat(n_1)}</Text>
              <Button key="repo-next" plain onPress={function () { return (0, claude_code_1.update)($, ghAtom, function (g) { return (__assign(__assign({}, g), { sel: (g.sel + 1) % n_1 })); }); }}>{'  ›'}</Button>
            </Box>)}
          {!repo_1 && <Text dimColor>No git repo found.</Text>}
          {repo_1 && __spreadArray(__spreadArray(__spreadArray(__spreadArray([
                                <Button key="gh-repo" plain onPress={function () { return (0, github_1.openUrl)($, repo_1.url); }}>{"".concat(slugName || repo_1.name, "  \u2197")}</Button>,
                                owner ? <Text key="gh-owner" dimColor>{owner}</Text> : null,
                                <Box key="gh-state" marginTop={1}>
              <Text color="green" bold>{"\u25CF ".concat(repo_1.branch)}</Text>
              <Text color={repo_1.ahead || repo_1.behind ? 'yellow' : undefined} dimColor={!repo_1.ahead && !repo_1.behind}>{"   \u2191".concat(repo_1.ahead, " \u2193").concat(repo_1.behind)}</Text>
              <Text color={repo_1.dirty ? 'yellow' : 'green'}>{repo_1.dirty ? "   \u270E ".concat(repo_1.dirty, " changed") : '   ✓ clean'}</Text>
            </Box>,
                                <Text key="gh-bh" bold color="cyan">{"\nOTHER BRANCHES  ".concat(others.length)}</Text>
                            ], others.map(function (b) { return (<Button key={"br-".concat(b.name)} plain onPress={function () { return (0, github_1.openUrl)($, link_1("/tree/".concat(encodeURIComponent(b.name)))); }}>
                {"  \u25CB ".concat(b.name).concat(b.ahead ? "  \u2191".concat(b.ahead) : '').concat(b.behind ? "  \u2193".concat(b.behind) : '')}
              </Button>); }), true), [
                                others.length ? null : <Text key="gh-nob" dimColor>{'  none'}</Text>,
                                <Text key="gh-ch" bold color="cyan">{'\nRECENT COMMITS'}</Text>
                            ], false), repo_1.commits.map(function (c) { return (<Box key={"c-".concat(c.sha)}>
                <Button key={"cb-".concat(c.sha)} plain onPress={function () { return (0, github_1.openUrl)($, link_1("/commit/".concat(c.sha))); }}>{"  ".concat(cut_1(c.subject))}</Button>
                <Text dimColor>{"  ".concat((0, exports.shortAge)(c.when))}</Text>
              </Box>); }), true), [
                                <Text key="gh-foot" dimColor>{"\n  click to open on GitHub".concat(((_h = repo_1.commits[0]) === null || _h === void 0 ? void 0 : _h.author) ? " \u00B7 latest by ".concat(repo_1.commits[0].author) : '')}</Text>,
                                <Button key="gh-refresh" plain onPress={function () { return (0, github_1.readGh)($, homeDir); }}>{'  ↻ refresh'}</Button>,
                            ], false).filter(Boolean)}
        </Box>)];
                case 9:
                    if (tab === 'connectors') {
                        hhmm = function (ms) { var t = new Date(ms); return "".concat(String(t.getHours()).padStart(2, '0'), ":").concat(String(t.getMinutes()).padStart(2, '0')); };
                        ordered = __spreadArray(__spreadArray([], conns.list.filter(function (c) { return c.kind === 'ok'; }), true), conns.list.filter(function (c) { return c.kind !== 'ok'; }), true);
                        COLOR_1 = { ok: 'green', auth: 'yellow', fail: 'red' };
                        MARK_1 = { ok: '✔', auth: '!', fail: '✖' };
                        connRow = function (c) { return [
                            <Box key={"c-".concat(c.name)}>
          <Text color={COLOR_1[c.kind]}>{"  ".concat(MARK_1[c.kind], " ")}</Text>
          <Text bold>{c.name}</Text>
          {c.kind !== 'ok' ? <Text color={COLOR_1[c.kind]}>{c.kind === 'auth' ? '  needs sign-in' : '  failed'}</Text> : null}
        </Box>,
                            c.account ? <Text key={"c-a-".concat(c.name)} dimColor>{"    ".concat(c.account)}</Text> : null,
                        ].filter(Boolean); };
                        return [2 /*return*/, (<Box flexDirection="column">
          {tabBar}
          <Text bold color="cyan">{"\u26A1 CONNECTORS  ".concat((0, connectors_1.connSummary)(conns.list))}</Text>
          {conns.login ? <Text dimColor>{"  Claude: ".concat(conns.login)}</Text> : null}
          {conns.list.length === 0 && <Text dimColor>{conns.checking ? '  checking…' : '  No check yet.'}</Text>}
          {ordered.flatMap(connRow)}
          <Box key="c-foot">
            <Text dimColor>{"  ".concat(conns.checking ? 'checking…' : conns.at ? "checked ".concat(hhmm(conns.at)) : 'not checked', "  ")}</Text>
            <Button key="c-refresh" plain onPress={function () { return (0, connectors_1.refreshConns)($, homeDir, true); }}>{'↻ refresh'}</Button>
          </Box>
        </Box>)];
                    }
                    return [2 /*return*/, (<Box flexDirection="column">
        {tabBar}
        {sections.length === 0 && <Text dimColor>Nothing running.</Text>}
        {sections.map(function (sec, n) {
                                var isFolded = folded.has(sec.key) || sec.folded;
                                return (<Box key={"s-".concat(sec.key)} flexDirection="column" marginBottom={n < sections.length - 1 || other.length ? 1 : 0}>
              <Button key={"h-".concat(sec.key)} hotkey={HOTKEYS[sec.key]} plain onPress={function () { return flip($, homeDir, sec.key); }}>
                {"".concat(isFolded ? '▸' : '▾', " ").concat(ICON[sec.key], " ").concat(sec.title, "  ").concat(sec.key === 'todo' ? openTodos : sec.key === 'done' ? sec.count + doneTodos.length : sec.count)}
              </Button>
              {!isFolded && (sec.key === 'todo' ? todoRows() : sec.key === 'running' ? runRows(sec.rows) : sec.key === 'done' ? doneRows(sec.rows) : plainRows(sec.rows, sec.key))}
            </Box>);
                            })}
        {other.map(function (l, i) { return <Text key={"o".concat(i)} dimColor>{l}</Text>; })}
      </Box>)];
            }
        });
    }); });
}
