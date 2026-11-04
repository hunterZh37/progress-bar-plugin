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
var testing_1 = require("claude-code/testing");
var connectors_1 = require("../hooks/connectors");
var group_1 = require("../hooks/group");
var mac_1 = require("../hooks/mac");
var panel_1 = require("../hooks/panel");
var render_1 = require("../hooks/render");
var NOW = 1800000000000;
var HOME = '/home/u';
var DIR = "".concat(HOME, "/.claude-progress");
(0, testing_1.test)('slug follows the rule', function () { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        (0, testing_1.expect)((0, render_1.slug)('Fix the Login bug!')).toBe('fix-the-login-bug');
        (0, testing_1.expect)((0, render_1.slug)('  Build docs (v2) ')).toBe('build-docs-v2');
        return [2 /*return*/];
    });
}); });
(0, testing_1.test)('a progress file renders as a bar', function () { return __awaiter(void 0, void 0, void 0, function () {
    var p, row;
    return __generator(this, function (_a) {
        p = (0, render_1.parseProgress)('{"done":2,"total":5,"step":"step"}');
        (0, testing_1.expect)(p).toEqual({ done: 2, total: 5, step: 'step', startedAt: undefined });
        row = { id: 'file:job', description: 'name', status: 'running', startedAt: NOW - 3 * 60000, tools: 0, lastTool: '', done: p.done, total: p.total, step: p.step };
        (0, testing_1.expect)((0, render_1.line)(row, NOW)).toBe('▶ name ████████░░░░░░░░░░░░ 40.0% · 2/5 · step · 3m');
        return [2 /*return*/];
    });
}); });
(0, testing_1.test)('a bad or partial file', function () { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        (0, testing_1.expect)((0, render_1.parseProgress)('not json')).toBe(null);
        (0, testing_1.expect)((0, render_1.parseProgress)('{"step":"x"}')).toEqual({ done: null, total: null, step: 'x', startedAt: undefined });
        return [2 /*return*/];
    });
}); });
(0, testing_1.test)('an agent row without a file says working, with tools', function () { return __awaiter(void 0, void 0, void 0, function () {
    var row;
    return __generator(this, function (_a) {
        row = { id: 'a1', description: 'fix-login', status: 'running', startedAt: NOW - 65 * 60000, tools: 4, lastTool: 'Edit', done: null, total: null, step: '' };
        (0, testing_1.expect)((0, render_1.line)(row, NOW)).toBe('▶ fix-login working · 1h05m · 4 tools · Edit');
        return [2 /*return*/];
    });
}); });
(0, testing_1.test)('lines are capped', function () { return __awaiter(void 0, void 0, void 0, function () {
    var rows, out;
    return __generator(this, function (_a) {
        rows = Array.from({ length: 9 }, function (_, i) { return ({ id: "file:j".concat(i), description: "j".concat(i), status: 'running', startedAt: NOW, tools: 0, lastTool: '', done: null, total: null, step: '' }); });
        out = (0, render_1.lines)(rows, NOW);
        (0, testing_1.expect)(out.length).toBe(6);
        (0, testing_1.expect)(out[5]).toBe('… 4 more');
        return [2 /*return*/];
    });
}); });
(0, testing_1.test)('the script chains an earlier status line', function () { return __awaiter(void 0, void 0, void 0, function () {
    var s;
    return __generator(this, function (_a) {
        s = (0, render_1.statusScript)("jq -r '.model'");
        (0, testing_1.expect)(s).toContain("prev='jq -r '\\''.model'\\'''");
        (0, testing_1.expect)(s).toContain('"$HOME/.claude-progress/.lines"');
        (0, testing_1.expect)((0, render_1.statusScript)()).toContain("prev=''");
        return [2 /*return*/];
    });
}); });
(0, testing_1.test)('the script pipes through the grouper and falls back without python3', function () { return __awaiter(void 0, void 0, void 0, function () {
    var s;
    return __generator(this, function (_a) {
        s = (0, render_1.statusScript)();
        (0, testing_1.expect)(s).toContain('group="$HOME/.claude/progress-bar/group.py"');
        (0, testing_1.expect)(s).toContain('command -v python3');
        (0, testing_1.expect)(s).toContain('| python3 "$group"');
        (0, testing_1.expect)(s).toContain('else\n  lines\nfi');
        return [2 /*return*/];
    });
}); });
var TODO = '# header\n[you]\nreview PR\nx old thing\n[mac]\nrun import | http://localhost:3000\n';
(0, testing_1.test)('to-do items: numbered, done ones marked, links kept', function () { return __awaiter(void 0, void 0, void 0, function () {
    var items;
    return __generator(this, function (_a) {
        items = (0, render_1.todoItems)(TODO);
        (0, testing_1.expect)(items.map(function (i) { return [i.index, i.heading, i.text, i.done]; })).toEqual([
            [1, 'you', 'review PR', false],
            [2, 'you', 'old thing', true],
            [3, 'mac', 'run import | http://localhost:3000', false],
        ]);
        (0, testing_1.expect)((0, render_1.todoList)(TODO)).toBe('[you]\n  1. review PR\n  2. [x] old thing\n[mac]\n  3. run import | http://localhost:3000');
        (0, testing_1.expect)((0, render_1.todoItems)('loose\n')[0].heading).toBe('todo');
        return [2 /*return*/];
    });
}); });
(0, testing_1.test)('todo add: [name], an existing heading word, or the last heading', function () { return __awaiter(void 0, void 0, void 0, function () {
    var fresh;
    return __generator(this, function (_a) {
        (0, testing_1.expect)((0, render_1.todoAdd)(TODO, '[you] call Sam').text).toBe('# header\n[you]\nreview PR\nx old thing\ncall Sam\n[mac]\nrun import | http://localhost:3000\n');
        (0, testing_1.expect)((0, render_1.todoAdd)(TODO, 'you call Sam').heading).toBe('you');
        (0, testing_1.expect)((0, render_1.todoAdd)(TODO, 'buy milk').text.endsWith('[mac]\nrun import | http://localhost:3000\nbuy milk\n')).toBe(true);
        (0, testing_1.expect)((0, render_1.todoAdd)(TODO, '[New Box] set up').text.endsWith('[New Box]\nset up\n')).toBe(true);
        fresh = (0, render_1.todoAdd)('', 'first');
        (0, testing_1.expect)(fresh.heading).toBe('todo');
        (0, testing_1.expect)(fresh.text.endsWith('[todo]\nfirst\n')).toBe(true);
        return [2 /*return*/];
    });
}); });
(0, testing_1.test)('todo done by number or text, and clear', function () { return __awaiter(void 0, void 0, void 0, function () {
    var cleared;
    return __generator(this, function (_a) {
        (0, testing_1.expect)((0, render_1.todoDone)(TODO, '3').text).toContain('\nx run import | http://localhost:3000\n');
        (0, testing_1.expect)((0, render_1.todoDone)(TODO, 'REVIEW').text).toContain('\nx review PR\n');
        (0, testing_1.expect)((0, render_1.todoDone)(TODO, 'nothing like it')).toBe(null);
        cleared = (0, render_1.todoClear)('[a]\nx gone\n[b]\nkeep\nx gone too\n');
        (0, testing_1.expect)(cleared).toEqual({ text: '[b]\nkeep\n', removed: 2 });
        return [2 /*return*/];
    });
}); });
(0, testing_1.test)('the grouper source is stdlib python and safe to embed', function () { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        (0, testing_1.expect)(group_1.GROUP_PY.startsWith('#!/usr/bin/env python3')).toBe(true);
        (0, testing_1.expect)(group_1.GROUP_PY).toContain('links.txt');
        (0, testing_1.expect)(group_1.GROUP_PY).toContain('folded.txt');
        (0, testing_1.expect)(group_1.GROUP_PY).toContain('todo.txt');
        (0, testing_1.expect)(group_1.GROUP_PY).not.toContain('hunty');
        return [2 /*return*/];
    });
}); });
(0, testing_1.test)('a watch file counts done/total from the last match, with an ETA', function () { return __awaiter(void 0, void 0, void 0, function () {
    var w, p;
    return __generator(this, function (_a) {
        w = (0, render_1.parseWatch)('{"log":"~/l.log","match":"(\\\\d+)/(\\\\d+) batches","startedAt":1}');
        (0, testing_1.expect)(w.log).toBe('~/l.log');
        p = (0, render_1.readLog)(w, '  10/40 batches, 1 min\n  20/40 batches, 2 min\n');
        (0, testing_1.expect)(p).toEqual({ done: 20, total: 40, step: '', error: false });
        (0, testing_1.expect)((0, render_1.eta)(20 * 60000, p.done, p.total)).toBe('20m');
        (0, testing_1.expect)((0, render_1.expandHome)('~/l.log', HOME)).toBe("".concat(HOME, "/l.log"));
        return [2 /*return*/];
    });
}); });
(0, testing_1.test)('a watch file counts finished steps, a step and an error', function () { return __awaiter(void 0, void 0, void 0, function () {
    var w, log;
    return __generator(this, function (_a) {
        w = (0, render_1.parseWatch)('{"log":"/x","count":"^(REFRESH MATERIALIZED VIEW|\\\\(1 row\\\\))$","total":5,"step":"^(REFRESH[A-Z ]+)$","error":"ERROR"}');
        log = 'SET\n(1 row)\nREFRESH MATERIALIZED VIEW\nREFRESH MATERIALIZED VIEW\n';
        (0, testing_1.expect)((0, render_1.readLog)(w, log)).toEqual({ done: 3, total: 5, step: 'REFRESH MATERIALIZED VIEW', error: false });
        (0, testing_1.expect)((0, render_1.readLog)(w, log + 'ERROR:  out of memory\n').error).toBe(true);
        return [2 /*return*/];
    });
}); });
(0, testing_1.test)('unusable watch files are null', function () { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        (0, testing_1.expect)((0, render_1.parseWatch)('{"match":"(\\\\d+)/(\\\\d+)"}')).toBe(null);
        (0, testing_1.expect)((0, render_1.parseWatch)('{"log":"/x"}')).toBe(null);
        (0, testing_1.expect)((0, render_1.parseWatch)('{"log":"/x","count":"x"}')).toBe(null);
        (0, testing_1.expect)((0, render_1.parseWatch)('{"log":"/x","match":"(unclosed"}')).toBe(null);
        return [2 /*return*/];
    });
}); });
(0, testing_1.test)('watched rows: done, stopped and error marks', function () { return __awaiter(void 0, void 0, void 0, function () {
    var base;
    return __generator(this, function (_a) {
        base = { id: 'watch:j', description: 'j', status: 'running', startedAt: NOW - 9 * 60000, tools: 0, lastTool: '', step: '' };
        (0, testing_1.expect)((0, render_1.line)(__assign(__assign({}, base), { done: 5, total: 5, state: 'done', eta: '' }), NOW)).toBe('✔ j ████████████████████ 100.0% · 5/5 · 9m');
        (0, testing_1.expect)((0, render_1.line)(__assign(__assign({}, base), { done: 2, total: 5, state: 'stopped', eta: '13m' }), NOW)).toBe('■ stopped j ████████░░░░░░░░░░░░ 40.0% · 2/5 · 9m · ETA 13m');
        (0, testing_1.expect)((0, render_1.line)(__assign(__assign({}, base), { done: null, total: null, state: 'error' }), NOW)).toBe('✖ error j · 9m');
        return [2 /*return*/];
    });
}); });
/** Runs `/progress-bar <args>` as the person would type it. */
var run = function ($, args) { return __awaiter(void 0, void 0, void 0, function () {
    var r;
    var _a;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0: return [4 /*yield*/, $.command.run({ command: 'progress-bar', args: args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })];
            case 1:
                r = _b.sent();
                return [2 /*return*/, __assign(__assign({}, r), { text: (_a = r.text) !== null && _a !== void 0 ? _a : '' })];
        }
    });
}); };
/** The world beneath the plugin: a home folder with one subagent and one job file. */
function world(on, opts) {
    if (opts === void 0) { opts = {}; }
    var written = {};
    var ran = [];
    testing_1.mock.clock(on, { now: NOW });
    testing_1.mock.env(on, { HOME: HOME });
    on('command.register', function () { return ({ value: { command: 'progress-bar' } }); });
    on('session.start', function (_, e) { return ({ cwd: e.cwd }); });
    on('agent.list', function () { return ({ value: [{ id: 'a1', description: 'Build docs', status: 'running' }] }); });
    on('fs.list', function (_, e) { return ({
        value: e.path === DIR
            ? [
                { name: 'build-docs.json', kind: 'file', size: 10, mtimeMs: NOW - 1000, isLink: false },
                { name: 'nightly-import.json', kind: 'file', size: 10, mtimeMs: NOW - 1000, isLink: false },
                { name: 'old.json', kind: 'file', size: 10, mtimeMs: NOW - 60 * 60000, isLink: false },
            ]
            : [],
    }); });
    on('fs.read', function (_, e) {
        var _a;
        var _b;
        var files = (_a = {},
            _a["".concat(DIR, "/build-docs.json")] = '{"done":1,"total":4,"step":"render"}',
            _a["".concat(DIR, "/nightly-import.json")] = "{\"done\":4,\"total\":5,\"step\":\"batch 4\",\"startedAt\":".concat(NOW - 12 * 60000, "}"),
            _a);
        var text = (_b = files[e.path]) !== null && _b !== void 0 ? _b : (e.path.endsWith('/todo.txt') ? written[e.path] : undefined);
        if (text === undefined)
            throw new Error('ENOENT');
        return { value: text };
    });
    on('fs.write', function (_, e) { written[e.path] = e.text; return { value: undefined }; });
    on('fs.exists', function () { return ({ value: !!opts.scriptExists }); });
    on('settings.read', function () { return ({ value: (opts.statusLine ? { statusLine: opts.statusLine } : {}) }); });
    on('process.run', function (_, e) {
        var _a;
        ran.push(__spreadArray([], e.argv, true));
        return { value: { exitCode: 0, stdout: e.argv[0] === 'uname' ? "".concat((_a = opts.os) !== null && _a !== void 0 ? _a : 'Darwin', "\n") : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } };
    });
    return { written: written, ran: ran };
}
(0, testing_1.test)('/progress-bar shows the bars and the setup state', function ($, on) { return __awaiter(void 0, void 0, void 0, function () {
    var written, text;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                written = world(on).written;
                return [4 /*yield*/, $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })];
            case 1:
                _a.sent();
                return [4 /*yield*/, run($, '')];
            case 2:
                text = (_a.sent()).text;
                (0, testing_1.expect)(text).toBe([
                    '▶ Build docs █████░░░░░░░░░░░░░░░ 25.0% · 1/4 · render · 0m · 0 tools',
                    '▶ nightly-import ████████████████░░░░ 80.0% · 4/5 · batch 4 · 12m',
                    '',
                    'Status line: off. Run `/progress-bar setup`.',
                ].join('\n'));
                (0, testing_1.expect)(written["".concat(DIR, "/.lines/jobs.txt")]).toContain("▶ nightly-import");
                return [2 /*return*/];
        }
    });
}); });
(0, testing_1.test)('/progress-bar setup writes the script and chains the old status line', function ($, on) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, written, ran, text, path;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                _a = world(on, { statusLine: { type: 'command', command: '~/bin/mine.sh' } }), written = _a.written, ran = _a.ran;
                return [4 /*yield*/, $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })];
            case 1:
                _b.sent();
                return [4 /*yield*/, run($, 'setup')];
            case 2:
                text = (_b.sent()).text;
                path = "".concat(HOME, "/.claude/progress-bar/statusline.sh");
                (0, testing_1.expect)(written[path]).toContain("prev='~/bin/mine.sh'");
                (0, testing_1.expect)(written["".concat(HOME, "/.claude/progress-bar/group.py")]).toBe(group_1.GROUP_PY);
                (0, testing_1.expect)(ran).toContainEqual(['chmod', '+x', path]);
                (0, testing_1.expect)(text).toContain('~/bin/mine.sh');
                (0, testing_1.expect)(text).toContain('"statusLine": { "type": "command", "command": "~/.claude/progress-bar/statusline.sh", "refreshInterval": 1 }');
                return [2 /*return*/];
        }
    });
}); });
(0, testing_1.test)('/progress-bar when the status line is wired', function ($, on) { return __awaiter(void 0, void 0, void 0, function () {
    var text;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                world(on, { statusLine: { type: 'command', command: '~/.claude/progress-bar/statusline.sh' }, scriptExists: true });
                return [4 /*yield*/, run($, '')];
            case 1:
                text = (_a.sent()).text;
                (0, testing_1.expect)(text).toContain('Status line: on.');
                return [2 /*return*/];
        }
    });
}); });
(0, testing_1.test)('/progress-bar shows a watched log, and stopped when its process is gone', function ($, on) { return __awaiter(void 0, void 0, void 0, function () {
    var LOG, alive, _a, _b;
    return __generator(this, function (_c) {
        switch (_c.label) {
            case 0:
                LOG = "".concat(HOME, "/logs/import.log");
                alive = true;
                testing_1.mock.clock(on, { now: NOW });
                testing_1.mock.env(on, { HOME: HOME });
                on('command.register', function () { return ({ value: { command: 'progress-bar' } }); });
                on('session.start', function (_, e) { return ({ cwd: e.cwd }); });
                on('agent.list', function () { return ({ value: [] }); });
                on('fs.list', function (_, e) { return ({
                    value: e.path === DIR ? [{ name: 'import.watch.json', kind: 'file', size: 10, mtimeMs: NOW - 3 * 60 * 60000, isLink: false }] : [],
                }); });
                on('fs.read', function (_, e) {
                    var _a;
                    var files = (_a = {},
                        _a["".concat(DIR, "/import.watch.json")] = "{\"log\":\"~/logs/import.log\",\"match\":\"(\\\\d+)/(\\\\d+) batches\",\"process\":\"^python .*import\",\"startedAt\":".concat(NOW - 60 * 60000, "}"),
                        _a[LOG] = '  10/40 batches\n  20/40 batches\n',
                        _a);
                    var text = files[e.path];
                    if (text === undefined)
                        throw new Error('ENOENT');
                    return { value: text };
                });
                on('fs.stat', function (_, e) {
                    if (e.path !== LOG)
                        throw new Error('ENOENT');
                    return { value: { name: 'import.log', kind: 'file', size: 30, mtimeMs: NOW - 30 * 60000, isLink: false } };
                });
                on('fs.write', function () { return ({ value: undefined }); });
                on('fs.exists', function () { return ({ value: false }); });
                on('settings.read', function () { return ({ value: {} }); });
                on('process.run', function (_, e) { return ({ value: { exitCode: e.argv[0] === 'pgrep' && !alive ? 1 : 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }); });
                return [4 /*yield*/, $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
                    // Log quiet for 30 min but the process lives: still shown, with an ETA from the hour so far.
                ];
            case 1:
                _c.sent();
                // Log quiet for 30 min but the process lives: still shown, with an ETA from the hour so far.
                _a = testing_1.expect;
                return [4 /*yield*/, run($, '')];
            case 2:
                // Log quiet for 30 min but the process lives: still shown, with an ETA from the hour so far.
                _a.apply(void 0, [(_c.sent()).text.split('\n')[0]]).toBe('▶ import ██████████░░░░░░░░░░ 50.0% · 20/40 · 1h00m · ETA 1h00m');
                // Process gone and log quiet past 10 min: hidden.
                alive = false;
                _b = testing_1.expect;
                return [4 /*yield*/, run($, '')];
            case 3:
                _b.apply(void 0, [(_c.sent()).text.split('\n')[0]]).toBe('No running jobs. Try `/progress-bar demo`.');
                return [2 /*return*/];
        }
    });
}); });
(0, testing_1.test)('/progress-bar with an unknown argument prints usage', function ($, on) { return __awaiter(void 0, void 0, void 0, function () {
    var text;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                world(on);
                return [4 /*yield*/, run($, 'nope')];
            case 1:
                text = (_a.sent()).text;
                (0, testing_1.expect)(text.split('\n')[0]).toBe('Usage: /progress-bar [setup | demo | clear | todo | panel [on|off] | fold <section> | unfold <section> | toggle <section>]');
                return [2 /*return*/];
        }
    });
}); });
(0, testing_1.test)('/progress-bar todo add, list, done and clear write todo.txt', function ($, on) { return __awaiter(void 0, void 0, void 0, function () {
    var written, file, _a, _b, _c, _d, _e, _f;
    return __generator(this, function (_g) {
        switch (_g.label) {
            case 0:
                written = world(on).written;
                file = "".concat(DIR, "/todo.txt");
                return [4 /*yield*/, $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })];
            case 1:
                _g.sent();
                _a = testing_1.expect;
                return [4 /*yield*/, run($, 'todo')];
            case 2:
                _a.apply(void 0, [(_g.sent()).text]).toContain('No to-dos.');
                _b = testing_1.expect;
                return [4 /*yield*/, run($, 'todo add [Mac] Run Import')];
            case 3:
                _b.apply(void 0, [(_g.sent()).text]).toContain('Added to [Mac].');
                return [4 /*yield*/, run($, 'todo add Call Sam')];
            case 4:
                _g.sent();
                (0, testing_1.expect)(written[file]).toContain('[Mac]\nRun Import\nCall Sam\n');
                _c = testing_1.expect;
                return [4 /*yield*/, run($, 'todo')];
            case 5:
                _c.apply(void 0, [(_g.sent()).text]).toBe('[Mac]\n  1. Run Import\n  2. Call Sam');
                _d = testing_1.expect;
                return [4 /*yield*/, run($, 'todo done 1')];
            case 6:
                _d.apply(void 0, [(_g.sent()).text]).toBe('Done: Run Import');
                _e = testing_1.expect;
                return [4 /*yield*/, run($, 'todo done sam')];
            case 7:
                _e.apply(void 0, [(_g.sent()).text]).toBe('Done: Call Sam');
                _f = testing_1.expect;
                return [4 /*yield*/, run($, 'todo clear')];
            case 8:
                _f.apply(void 0, [(_g.sent()).text]).toBe('Removed 2 done items.');
                (0, testing_1.expect)(written[file]).not.toContain('Run Import');
                return [2 /*return*/];
        }
    });
}); });
(0, testing_1.test)('mac-clicks parsing', function () { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        (0, testing_1.expect)((0, mac_1.parseMacClicks)('mac-clicks')).toBe('on');
        (0, testing_1.expect)((0, mac_1.parseMacClicks)('--mac-clicks')).toBe('on');
        (0, testing_1.expect)((0, mac_1.parseMacClicks)('mac-clicks off')).toBe('off');
        (0, testing_1.expect)((0, mac_1.parseMacClicks)('--mac-clicks OFF')).toBe('off');
        (0, testing_1.expect)((0, mac_1.parseMacClicks)('mac-clicks maybe')).toBe(null);
        (0, testing_1.expect)((0, mac_1.parseMacClicks)('clicks')).toBe(null);
        return [2 /*return*/];
    });
}); });
(0, testing_1.test)('the toggle AppleScript only writes known section keys', function () { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        (0, testing_1.expect)(mac_1.TOGGLE_APPLESCRIPT).toContain('if sec is in {"todo", "running", "waiting", "done", "problems"} then');
        (0, testing_1.expect)(mac_1.TOGGLE_APPLESCRIPT).toContain('.claude-progress/.state/folded.txt');
        return [2 /*return*/];
    });
}); });
/** A world for setup mac-clicks: uname answers `os`, every other command succeeds. */
var macWorld = function (on, os) { return world(on, { os: os }); };
(0, testing_1.test)('/progress-bar setup mac-clicks on Linux says it needs macOS and runs nothing else', function ($, on) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, written, ran, text;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                _a = macWorld(on, 'Linux'), written = _a.written, ran = _a.ran;
                return [4 /*yield*/, run($, 'setup mac-clicks')];
            case 1:
                text = (_b.sent()).text;
                (0, testing_1.expect)(text).toBe(mac_1.NOT_MAC);
                (0, testing_1.expect)(ran).toEqual([['uname']]);
                (0, testing_1.expect)(written["".concat(HOME, "/.claude-progress/.state/clicks-on")]).toBe(undefined);
                return [2 /*return*/];
        }
    });
}); });
(0, testing_1.test)('/progress-bar setup --mac-clicks on macOS builds, signs and registers the app, then turns links on', function ($, on) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, written, ran, text, app, script;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                _a = macWorld(on, 'Darwin'), written = _a.written, ran = _a.ran;
                return [4 /*yield*/, run($, 'setup --mac-clicks')];
            case 1:
                text = (_b.sent()).text;
                app = "".concat(HOME, "/Applications/ProgressBarToggle.app");
                script = "".concat(HOME, "/.claude/progress-bar/ProgressBarToggle.applescript");
                (0, testing_1.expect)(text).toContain('Click to fold is on.');
                (0, testing_1.expect)(written[script]).toBe(mac_1.TOGGLE_APPLESCRIPT);
                (0, testing_1.expect)(ran).toContainEqual(['osacompile', '-o', app, script]);
                (0, testing_1.expect)(ran).toContainEqual(['/usr/libexec/PlistBuddy', '-c', 'Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string progressbar', "".concat(app, "/Contents/Info.plist")]);
                (0, testing_1.expect)(ran).toContainEqual(['/usr/libexec/PlistBuddy', '-c', 'Set :CFBundleIdentifier com.hunterzh37.progressbar-toggle', "".concat(app, "/Contents/Info.plist")]);
                (0, testing_1.expect)(ran).toContainEqual(['codesign', '--force', '--deep', '-s', '-', app]);
                (0, testing_1.expect)(ran).toContainEqual([mac_1.LSREGISTER, '-f', app]);
                (0, testing_1.expect)(written["".concat(HOME, "/.claude-progress/.state/clicks-on")]).toBe('');
                (0, testing_1.expect)(written["".concat(HOME, "/.claude/progress-bar/group.py")]).toBe(group_1.GROUP_PY);
                return [2 /*return*/];
        }
    });
}); });
(0, testing_1.test)('/progress-bar setup mac-clicks off unregisters and removes the app and flag', function ($, on) { return __awaiter(void 0, void 0, void 0, function () {
    var ran, text, app;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                ran = macWorld(on, 'Darwin').ran;
                return [4 /*yield*/, run($, 'setup mac-clicks off')];
            case 1:
                text = (_a.sent()).text;
                app = "".concat(HOME, "/Applications/ProgressBarToggle.app");
                (0, testing_1.expect)(text).toContain('Click to fold is off.');
                (0, testing_1.expect)(ran).toContainEqual([mac_1.LSREGISTER, '-u', app]);
                (0, testing_1.expect)(ran).toContainEqual(['rm', '-rf', app, "".concat(HOME, "/.claude/progress-bar/ProgressBarToggle.applescript"), "".concat(HOME, "/.claude-progress/.state/clicks-on")]);
                return [2 /*return*/];
        }
    });
}); });
(0, testing_1.test)('the script prints one summary line while the panel is on, unless PB_FULL=1', function () { return __awaiter(void 0, void 0, void 0, function () {
    var s;
    return __generator(this, function (_a) {
        s = (0, render_1.statusScript)();
        (0, testing_1.expect)(s).toContain('if [ -f "$HOME/.claude-progress/.state/panel-on" ] && [ "$PB_FULL" != 1 ]; then mode=--summary; fi');
        (0, testing_1.expect)(s).toContain('| python3 "$group" $mode');
        (0, testing_1.expect)(group_1.GROUP_PY).toContain("'--summary' in sys.argv[1:]");
        (0, testing_1.expect)(group_1.GROUP_PY).toContain("full view in the Status panel");
        return [2 /*return*/];
    });
}); });
(0, testing_1.test)('prevOf reads the chained command back out of an installed script', function () { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        (0, testing_1.expect)((0, render_1.prevOf)((0, render_1.statusScript)("jq -r '.model'"))).toBe("jq -r '.model'");
        (0, testing_1.expect)((0, render_1.prevOf)((0, render_1.statusScript)())).toBe(undefined);
        return [2 /*return*/];
    });
}); });
var FULL = [
    '\x1b]8;;progressbar://toggle/todo\x07▾ ☐ TO-DO\x1b]8;;\x07',
    '  YOU: review PR · call Sam',
    '  MAC: run import',
    '▾ ▶ RUNNING',
    '  \x1b[33m⚠ stuck 12m\x1b[0m nightly-import ████████████████░░░░ 80.0% · 4/5 · batch 4 · 12m',
    '  ◐ Build docs █████░░░░░░░░░░░░░░░ 25.0% · 1/4 · render · 0m · 0 tools',
    '▸ ✔ DONE (2)',
    'opus 4 · main',
].join('\n');
(0, testing_1.test)('the panel parser: sections, counts, folded headers and trailing lines', function () { return __awaiter(void 0, void 0, void 0, function () {
    var _a, sections, other;
    return __generator(this, function (_b) {
        _a = (0, panel_1.parseSections)((0, panel_1.stripAnsi)(FULL).split('\n')), sections = _a.sections, other = _a.other;
        (0, testing_1.expect)(sections.map(function (s) { return [s.key, s.folded, s.count, s.rows.length]; })).toEqual([['todo', false, 3, 2], ['running', false, 2, 2], ['done', true, 2, 0]]);
        (0, testing_1.expect)(other).toEqual(['opus 4 · main']);
        (0, testing_1.expect)((0, panel_1.runningRow)(sections[1].rows[0])).toEqual({ mark: '⚠ 12m', stuck: true, name: 'nightly-import', pct: 80, details: '4/5 · batch 4 · 12m' });
        (0, testing_1.expect)((0, panel_1.runningRow)(sections[1].rows[1]).mark).toBe('◐');
        return [2 /*return*/];
    });
}); });
/** A world for the panel: the status script answers `full`, files live in `files`. */
function panelWorld(on, files, full, answer) {
    if (full === void 0) { full = FULL; }
    if (answer === void 0) { answer = function () { return undefined; }; }
    var ran = [];
    testing_1.mock.clock(on, { now: NOW });
    testing_1.mock.env(on, { HOME: HOME });
    on('command.register', function () { return ({ value: { command: 'progress-bar' } }); });
    on('session.start', function (_, e) { return ({ cwd: e.cwd }); });
    on('agent.list', function () { return ({ value: [] }); });
    on('fs.list', function () { return ({ value: [] }); });
    on('fs.read', function (_, e) {
        var text = files[e.path];
        if (text === undefined)
            throw new Error('ENOENT');
        return { value: text };
    });
    on('fs.write', function (_, e) { files[e.path] = e.text; return { value: undefined }; });
    on('fs.exists', function (_, e) { return ({ value: e.path in files }); });
    on('settings.read', function () { return ({ value: {} }); });
    on('process.run', function (_, e) {
        var _a, _b, _c, _d;
        ran.push({ argv: __spreadArray([], e.argv, true), env: (_a = e.init) === null || _a === void 0 ? void 0 : _a.env, stdin: (_b = e.init) === null || _b === void 0 ? void 0 : _b.stdin });
        if (e.argv[0] === 'rm')
            for (var _i = 0, _e = e.argv.slice(2); _i < _e.length; _i++) {
                var f = _e[_i];
                delete files[f];
            }
        var stdout = ((_c = e.argv[1]) === null || _c === void 0 ? void 0 : _c.endsWith('statusline.sh')) ? full : ((_d = answer(__spreadArray([], e.argv, true))) !== null && _d !== void 0 ? _d : '');
        return { value: { exitCode: 0, stdout: stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } };
    });
    var opened = [];
    on('ui.open', function (_, e) { opened.push(e.id); return { value: { isPlaced: true } }; });
    on('ui.close', function () { return ({ value: undefined }); });
    on('ui.panes', function () { return ({ value: [] }); });
    return { ran: ran, opened: opened };
}
var SCRIPT = "".concat(HOME, "/.claude/progress-bar/statusline.sh");
var FLAG = "".concat(DIR, "/.state/panel-on");
var FOLDED = "".concat(DIR, "/.state/folded.txt");
var TODO_FILE = "".concat(DIR, "/todo.txt");
var PANE_PROPS = { title: 'Status', isFocused: false, bodyColumns: 52, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} };
(0, testing_1.test)('the panel draws sections and rows, and a header press writes folded.txt', function ($, on) { return __awaiter(void 0, void 0, void 0, function () {
    var files, _a, ran, opened, ui, _b, _c, _d, _e, _f;
    var _g;
    var _h, _j, _k, _l, _m;
    return __generator(this, function (_o) {
        switch (_o.label) {
            case 0:
                files = (_g = {}, _g[SCRIPT] = (0, render_1.statusScript)(), _g[FLAG] = 'on\n', _g[TODO_FILE] = '[you]\nreview PR\ncall Sam\n[mac]\nrun import\n', _g);
                _a = panelWorld(on, files), ran = _a.ran, opened = _a.opened;
                return [4 /*yield*/, $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })];
            case 1:
                _o.sent();
                (0, testing_1.expect)(opened).toEqual([panel_1.PANE]);
                (0, testing_1.expect)(ran).toContainEqual({ argv: ['/bin/sh', SCRIPT], env: { PB_FULL: '1' }, stdin: '{}' });
                return [4 /*yield*/, $.ui.mount({ plugin: 'progress-bar', surface: 'terminal', component: 'Pane', requestId: panel_1.PANE, props: { title: 'Status', isFocused: false, bodyColumns: 52, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } })];
            case 2:
                ui = _o.sent();
                _b = testing_1.expect;
                return [4 /*yield*/, ui.find({ type: 'Text', text: /^  You$/ })];
            case 3:
                _b.apply(void 0, [(_h = (_o.sent())) === null || _h === void 0 ? void 0 : _h.text]).toBe('  You');
                _c = testing_1.expect;
                return [4 /*yield*/, ui.find({ type: 'Button', text: /call Sam/ })];
            case 4:
                _c.apply(void 0, [(_j = (_o.sent())) === null || _j === void 0 ? void 0 : _j.text]).toBe('    ○ call Sam');
                _d = testing_1.expect;
                return [4 /*yield*/, ui.find({ type: 'Button', text: /TO-DO/ })];
            case 5:
                _d.apply(void 0, [(_k = (_o.sent())) === null || _k === void 0 ? void 0 : _k.text]).toBe('▾ ☐ TO-DO  3');
                _e = testing_1.expect;
                return [4 /*yield*/, ui.find({ type: 'Text', text: /^nightly-import$/ })];
            case 6:
                _e.apply(void 0, [(_l = (_o.sent())) === null || _l === void 0 ? void 0 : _l.text]).toBe('nightly-import');
                _f = testing_1.expect;
                return [4 /*yield*/, ui.find({ type: 'Text', text: /4\/5 · batch 4/ })];
            case 7:
                _f.apply(void 0, [(_m = (_o.sent())) === null || _m === void 0 ? void 0 : _m.text]).toBe('    4/5 · batch 4 · 12m');
                return [4 /*yield*/, ui.press({ key: 'h-running' })];
            case 8:
                _o.sent();
                (0, testing_1.expect)(files[FOLDED]).toBe('running');
                return [4 /*yield*/, ui.press({ key: 'h-running' })];
            case 9:
                _o.sent();
                (0, testing_1.expect)(files[FOLDED]).toBe('');
                return [4 /*yield*/, ui.unmount()];
            case 10:
                _o.sent();
                return [2 /*return*/];
        }
    });
}); });
(0, testing_1.test)('/progress-bar panel on and off: the flag file, and setup first', function ($, on) { return __awaiter(void 0, void 0, void 0, function () {
    var files, opened, _a, _b, _c, _d;
    return __generator(this, function (_e) {
        switch (_e.label) {
            case 0:
                files = {};
                opened = panelWorld(on, files).opened;
                return [4 /*yield*/, $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })];
            case 1:
                _e.sent();
                (0, testing_1.expect)(opened).toEqual([]);
                _a = testing_1.expect;
                return [4 /*yield*/, run($, 'panel')];
            case 2:
                _a.apply(void 0, [(_e.sent()).text]).toContain('Run `/progress-bar setup` first.');
                files[SCRIPT] = (0, render_1.statusScript)("jq -r '.model'");
                _b = testing_1.expect;
                return [4 /*yield*/, run($, 'panel on')];
            case 3:
                _b.apply(void 0, [(_e.sent()).text]).toContain('Status panel on');
                (0, testing_1.expect)(files[FLAG]).toBe('on\n');
                (0, testing_1.expect)((0, render_1.prevOf)(files[SCRIPT])).toBe("jq -r '.model'");
                (0, testing_1.expect)(files["".concat(HOME, "/.claude/progress-bar/group.py")]).toBe(group_1.GROUP_PY);
                (0, testing_1.expect)(opened).toEqual([panel_1.PANE]);
                _c = testing_1.expect;
                return [4 /*yield*/, run($, 'panel off')];
            case 4:
                _c.apply(void 0, [(_e.sent()).text]).toContain('Status panel off');
                (0, testing_1.expect)(files[FLAG]).toBe(undefined);
                _d = testing_1.expect;
                return [4 /*yield*/, run($, 'panel')];
            case 5:
                _d.apply(void 0, [(_e.sent()).text]).toContain('`/progress-bar panel on` opens it at every session start.');
                return [2 /*return*/];
        }
    });
}); });
var DONE_FULL = '▾ ▶ RUNNING\n  ◐ job ██░░ 50.0% · 1/2\n▾ ✔ DONE\n  nightly · finished 10:12\n';
(0, testing_1.test)('open to-dos under TO-DO, checked-off ones under DONE; the menu marks done, moves back and deletes', function ($, on) { return __awaiter(void 0, void 0, void 0, function () {
    var files, ui, _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
    var _q;
    var _r, _s, _t, _u, _v, _w, _x, _y, _z, _0;
    return __generator(this, function (_1) {
        switch (_1.label) {
            case 0:
                files = (_q = {}, _q[SCRIPT] = (0, render_1.statusScript)(), _q[FLAG] = 'on\n', _q[TODO_FILE] = '# note\n[you]\nreview PR | https://x.test/1\nx old thing\ncall Sam\n[mac]\nx all done here\n', _q);
                panelWorld(on, files, DONE_FULL);
                return [4 /*yield*/, $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })];
            case 1:
                _1.sent();
                return [4 /*yield*/, $.ui.mount({ plugin: 'progress-bar', surface: 'terminal', component: 'Pane', requestId: panel_1.PANE, props: PANE_PROPS })];
            case 2:
                ui = _1.sent();
                _a = testing_1.expect;
                return [4 /*yield*/, ui.find({ type: 'Button', text: /TO-DO/ })];
            case 3:
                _a.apply(void 0, [(_r = (_1.sent())) === null || _r === void 0 ? void 0 : _r.text]).toBe('▾ ☐ TO-DO  2');
                _b = testing_1.expect;
                return [4 /*yield*/, ui.find({ type: 'Button', text: /review PR/ })];
            case 4:
                _b.apply(void 0, [(_s = (_1.sent())) === null || _s === void 0 ? void 0 : _s.text]).toBe('    ○ review PR');
                _c = testing_1.expect;
                return [4 /*yield*/, ui.find({ type: 'Text', text: /^  Mac$/ })];
            case 5:
                _c.apply(void 0, [_1.sent()]).toBe(undefined);
                _d = testing_1.expect;
                return [4 /*yield*/, ui.find({ type: 'Button', text: /DONE/ })];
            case 6:
                _d.apply(void 0, [(_t = (_1.sent())) === null || _t === void 0 ? void 0 : _t.text]).toBe('▾ ✔ DONE  3');
                _e = testing_1.expect;
                return [4 /*yield*/, ui.find({ type: 'Text', text: /Checked-off to-dos/ })];
            case 7:
                _e.apply(void 0, [(_u = (_1.sent())) === null || _u === void 0 ? void 0 : _u.text]).toBe('  Checked-off to-dos');
                _f = testing_1.expect;
                return [4 /*yield*/, ui.find({ type: 'Button', text: /old thing/ })];
            case 8:
                _f.apply(void 0, [(_v = (_1.sent())) === null || _v === void 0 ? void 0 : _v.text]).toBe('    ✓ old thing');
                _g = testing_1.expect;
                return [4 /*yield*/, ui.find({ type: 'Button', text: /Mark as done/ })];
            case 9:
                _g.apply(void 0, [_1.sent()]).toBe(undefined);
                return [4 /*yield*/, ui.press({ key: 't-2' })];
            case 10:
                _1.sent();
                _h = testing_1.expect;
                return [4 /*yield*/, ui.find({ type: 'Button', text: /Mark as done/ })];
            case 11:
                _h.apply(void 0, [(_w = (_1.sent())) === null || _w === void 0 ? void 0 : _w.text]).toBe('✓ Mark as done  ');
                _j = testing_1.expect;
                return [4 /*yield*/, ui.find({ type: 'Button', text: /Move back/ })];
            case 12:
                _j.apply(void 0, [_1.sent()]).toBe(undefined);
                return [4 /*yield*/, ui.press({ key: 'a-done-2' })];
            case 13:
                _1.sent();
                (0, testing_1.expect)(files[TODO_FILE]).toBe('# note\n[you]\nx review PR | https://x.test/1\nx old thing\ncall Sam\n[mac]\nx all done here\n');
                _k = testing_1.expect;
                return [4 /*yield*/, ui.find({ type: 'Button', text: /TO-DO/ })];
            case 14:
                _k.apply(void 0, [(_x = (_1.sent())) === null || _x === void 0 ? void 0 : _x.text]).toBe('▾ ☐ TO-DO  1');
                _l = testing_1.expect;
                return [4 /*yield*/, ui.find({ type: 'Button', text: /review PR/ })];
            case 15:
                _l.apply(void 0, [(_y = (_1.sent())) === null || _y === void 0 ? void 0 : _y.text]).toBe('    ✓ review PR');
                return [4 /*yield*/, ui.press({ key: 't-3' })];
            case 16:
                _1.sent();
                _m = testing_1.expect;
                return [4 /*yield*/, ui.find({ type: 'Button', text: /Move back/ })];
            case 17:
                _m.apply(void 0, [(_z = (_1.sent())) === null || _z === void 0 ? void 0 : _z.text]).toBe('○ Move back to to-do  ');
                return [4 /*yield*/, ui.press({ key: 'a-todo-3' })];
            case 18:
                _1.sent();
                (0, testing_1.expect)(files[TODO_FILE]).toBe('# note\n[you]\nx review PR | https://x.test/1\nold thing\ncall Sam\n[mac]\nx all done here\n');
                _o = testing_1.expect;
                return [4 /*yield*/, ui.find({ type: 'Button', text: /old thing/ })];
            case 19:
                _o.apply(void 0, [(_0 = (_1.sent())) === null || _0 === void 0 ? void 0 : _0.text]).toBe('    ○ old thing');
                return [4 /*yield*/, ui.press({ key: 't-4' })];
            case 20:
                _1.sent();
                return [4 /*yield*/, ui.press({ key: 'a-del-4' })];
            case 21:
                _1.sent();
                (0, testing_1.expect)(files[TODO_FILE]).toBe('# note\n[you]\nx review PR | https://x.test/1\nold thing\n[mac]\nx all done here\n');
                return [4 /*yield*/, ui.press({ key: 't-3' })];
            case 22:
                _1.sent();
                return [4 /*yield*/, ui.press({ key: 'a-x-3' })];
            case 23:
                _1.sent();
                _p = testing_1.expect;
                return [4 /*yield*/, ui.find({ type: 'Button', text: /Delete/ })];
            case 24:
                _p.apply(void 0, [_1.sent()]).toBe(undefined);
                return [4 /*yield*/, ui.unmount()];
            case 25:
                _1.sent();
                return [2 /*return*/];
        }
    });
}); });
(0, testing_1.test)('with every to-do done, TO-DO hides and DONE shows them, so one can be moved back', function ($, on) { return __awaiter(void 0, void 0, void 0, function () {
    var files, ui, _a, _b, _c, _d;
    var _e;
    var _f, _g;
    return __generator(this, function (_h) {
        switch (_h.label) {
            case 0:
                files = (_e = {}, _e[SCRIPT] = (0, render_1.statusScript)(), _e[FLAG] = 'on\n', _e[TODO_FILE] = '[mac]\nx run import\n', _e);
                panelWorld(on, files, '▾ ▶ RUNNING\n  ◐ job ██░░ 50.0% · 1/2\n');
                return [4 /*yield*/, $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })];
            case 1:
                _h.sent();
                return [4 /*yield*/, $.ui.mount({ plugin: 'progress-bar', surface: 'terminal', component: 'Pane', requestId: panel_1.PANE, props: PANE_PROPS })];
            case 2:
                ui = _h.sent();
                _a = testing_1.expect;
                return [4 /*yield*/, ui.find({ type: 'Button', text: /TO-DO/ })];
            case 3:
                _a.apply(void 0, [_h.sent()]).toBe(undefined);
                _b = testing_1.expect;
                return [4 /*yield*/, ui.find({ type: 'Button', text: /DONE/ })];
            case 4:
                _b.apply(void 0, [(_f = (_h.sent())) === null || _f === void 0 ? void 0 : _f.text]).toBe('▾ ✔ DONE  1');
                return [4 /*yield*/, ui.press({ key: 't-1' })];
            case 5:
                _h.sent();
                return [4 /*yield*/, ui.press({ key: 'a-todo-1' })];
            case 6:
                _h.sent();
                (0, testing_1.expect)(files[TODO_FILE]).toBe('[mac]\nrun import\n');
                _c = testing_1.expect;
                return [4 /*yield*/, ui.find({ type: 'Button', text: /TO-DO/ })];
            case 7:
                _c.apply(void 0, [(_g = (_h.sent())) === null || _g === void 0 ? void 0 : _g.text]).toBe('▾ ☐ TO-DO  1');
                _d = testing_1.expect;
                return [4 /*yield*/, ui.find({ type: 'Button', text: /DONE/ })];
            case 8:
                _d.apply(void 0, [_h.sent()]).toBe(undefined);
                return [4 /*yield*/, ui.unmount()];
            case 9:
                _h.sent();
                return [2 /*return*/];
        }
    });
}); });
var SECRET = 'hunter2-s3cret';
var MCP_LIST = [
    'Checking MCP server health…',
    '',
    'claude.ai Gmail: https://gmail.mcp.claude.com/mcp - ✔ Connected',
    'claude.ai Canva: https://mcp.canva.com/mcp - ! Needs authentication',
    'claude.ai Adobe for creativity: https://adobe.example/mcp - ! Needs authentication',
    "db: npx -y @modelcontextprotocol/server-postgres postgres://admin:".concat(SECRET, "@db.example.com:5432/prod - \u2714 Connected"),
    "broken: node /x/server.js --token ".concat(SECRET, " - \u2717 Failed to connect"),
].join('\n');
var AUTH = JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'me@x.test', orgName: 'Acme', orgId: 'org-1', accessToken: SECRET });
(0, testing_1.test)('connector parsing keeps name and status only', function () { return __awaiter(void 0, void 0, void 0, function () {
    var cache;
    return __generator(this, function (_a) {
        (0, testing_1.expect)((0, connectors_1.parseMcpList)(MCP_LIST)).toEqual([
            { name: 'Gmail', kind: 'ok' },
            { name: 'Canva', kind: 'auth' },
            { name: 'Adobe', kind: 'auth' },
            { name: 'db', kind: 'ok' },
            { name: 'broken', kind: 'fail' },
        ]);
        (0, testing_1.expect)(JSON.stringify((0, connectors_1.parseMcpList)(MCP_LIST))).not.toContain(SECRET);
        (0, testing_1.expect)((0, connectors_1.connName)('https://x.test/a')).toBe('');
        (0, testing_1.expect)((0, connectors_1.parseLogin)(AUTH)).toBe('me@x.test · Acme');
        (0, testing_1.expect)((0, connectors_1.parseLogin)('{"loggedIn":false,"email":"a@b"}')).toBe('');
        (0, testing_1.expect)((0, connectors_1.parseLogin)('not json')).toBe('');
        cache = (0, connectors_1.formatCache)((0, connectors_1.parseMcpList)(MCP_LIST), 'me@x.test · Acme', 1800000000000);
        (0, testing_1.expect)(cache).toBe('Gmail\tok\nCanva\tauth\nAdobe\tauth\ndb\tok\nbroken\tfail\n#login\tme@x.test · Acme\n#checked\t1800000000\n');
        (0, testing_1.expect)((0, connectors_1.parseCache)(cache)).toEqual({ at: 1800000000000, login: 'me@x.test · Acme', list: (0, connectors_1.parseMcpList)(MCP_LIST) });
        (0, testing_1.expect)((0, connectors_1.parseAccounts)('# comment\nGmail\tme@gmail.test\nbad line\n')).toEqual(new Map([['Gmail', 'me@gmail.test']]));
        (0, testing_1.expect)((0, connectors_1.connSummary)((0, connectors_1.parseMcpList)(MCP_LIST))).toBe('2 ok · 2 need sign-in · 1 failed');
        return [2 /*return*/];
    });
}); });
/** Every text the drawing holds, joined. */
function allText(ui) {
    return __awaiter(this, void 0, void 0, function () {
        var out, _i, _a, type, _b, _c, el;
        var _d;
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0:
                    out = [];
                    _i = 0, _a = ['Text', 'Button'];
                    _e.label = 1;
                case 1:
                    if (!(_i < _a.length)) return [3 /*break*/, 6];
                    type = _a[_i];
                    _b = 0;
                    return [4 /*yield*/, ui.findAll({ type: type })];
                case 2:
                    _c = _e.sent();
                    _e.label = 3;
                case 3:
                    if (!(_b < _c.length)) return [3 /*break*/, 5];
                    el = _c[_b];
                    out.push((_d = el.text) !== null && _d !== void 0 ? _d : '');
                    _e.label = 4;
                case 4:
                    _b++;
                    return [3 /*break*/, 3];
                case 5:
                    _i++;
                    return [3 /*break*/, 1];
                case 6: return [2 /*return*/, out.join('\n')];
            }
        });
    });
}
(0, testing_1.test)('the Connectors tab: checks claude mcp list, caches name and status only, never a URL or secret', function ($, on) { return __awaiter(void 0, void 0, void 0, function () {
    var CACHE, files, ran, ui, _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, text;
    var _p;
    var _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0;
    return __generator(this, function (_1) {
        switch (_1.label) {
            case 0:
                CACHE = "".concat(HOME, "/").concat(connectors_1.CONN_CACHE_REL);
                files = (_p = {}, _p[SCRIPT] = (0, render_1.statusScript)(), _p[FLAG] = 'on\n', _p["".concat(DIR, "/connector-accounts.txt")] = '# accounts\nGmail\tme@gmail.test\n', _p);
                ran = panelWorld(on, files, DONE_FULL, function (argv) {
                    return argv[0] === 'claude' && argv[1] === 'mcp' ? MCP_LIST : argv[0] === 'claude' && argv[1] === 'auth' ? AUTH : undefined;
                }).ran;
                return [4 /*yield*/, $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })];
            case 1:
                _1.sent();
                return [4 /*yield*/, $.ui.mount({ plugin: 'progress-bar', surface: 'terminal', component: 'Pane', requestId: panel_1.PANE, props: PANE_PROPS })];
            case 2:
                ui = _1.sent();
                (0, testing_1.expect)(ran).toContainEqual({ argv: ['claude', 'mcp', 'list'], env: undefined, stdin: undefined });
                (0, testing_1.expect)(ran.filter(function (r) { return r.argv[0] === 'claude' && r.argv[1] === 'mcp'; }).length).toBe(1);
                (0, testing_1.expect)(files[CACHE]).toContain('db\tok\n');
                (0, testing_1.expect)(files[CACHE]).not.toContain(SECRET);
                (0, testing_1.expect)(files[CACHE]).not.toContain('postgres');
                (0, testing_1.expect)(files[CACHE]).not.toContain('https');
                _a = testing_1.expect;
                return [4 /*yield*/, ui.find({ type: 'Button', text: /List/ })];
            case 3:
                _a.apply(void 0, [(_q = (_1.sent())) === null || _q === void 0 ? void 0 : _q.text]).toBe('[ List ]');
                _b = testing_1.expect;
                return [4 /*yield*/, ui.find({ type: 'Button', text: /Connectors/ })];
            case 4:
                _b.apply(void 0, [(_r = (_1.sent())) === null || _r === void 0 ? void 0 : _r.text]).toBe('  Connectors !3  ');
                _c = testing_1.expect;
                return [4 /*yield*/, ui.find({ type: 'Button', text: /RUNNING/ })];
            case 5:
                _c.apply(void 0, [(_s = (_1.sent())) === null || _s === void 0 ? void 0 : _s.text]).toBe('▾ ▶ RUNNING  1');
                _d = testing_1.expect;
                return [4 /*yield*/, ui.find({ type: 'Text', text: /CONNECTORS/ })];
            case 6:
                _d.apply(void 0, [_1.sent()]).toBe(undefined);
                return [4 /*yield*/, ui.press({ key: 'tab-connectors' })];
            case 7:
                _1.sent();
                _e = testing_1.expect;
                return [4 /*yield*/, ui.find({ type: 'Button', text: /Connectors/ })];
            case 8:
                _e.apply(void 0, [(_t = (_1.sent())) === null || _t === void 0 ? void 0 : _t.text]).toBe('[ Connectors !3 ]');
                _f = testing_1.expect;
                return [4 /*yield*/, ui.find({ type: 'Button', text: /RUNNING/ })];
            case 9:
                _f.apply(void 0, [_1.sent()]).toBe(undefined);
                _g = testing_1.expect;
                return [4 /*yield*/, ui.find({ type: 'Text', text: /CONNECTORS/ })];
            case 10:
                _g.apply(void 0, [(_u = (_1.sent())) === null || _u === void 0 ? void 0 : _u.text]).toBe('⚡ CONNECTORS  2 ok · 2 need sign-in · 1 failed');
                _h = testing_1.expect;
                return [4 /*yield*/, ui.find({ type: 'Text', text: /Claude:/ })];
            case 11:
                _h.apply(void 0, [(_v = (_1.sent())) === null || _v === void 0 ? void 0 : _v.text]).toBe('  Claude: me@x.test · Acme');
                _j = testing_1.expect;
                return [4 /*yield*/, ui.find({ type: 'Text', text: /^Gmail$/ })];
            case 12:
                _j.apply(void 0, [(_w = (_1.sent())) === null || _w === void 0 ? void 0 : _w.text]).toBe('Gmail');
                _k = testing_1.expect;
                return [4 /*yield*/, ui.find({ type: 'Text', text: /me@gmail/ })];
            case 13:
                _k.apply(void 0, [(_x = (_1.sent())) === null || _x === void 0 ? void 0 : _x.text]).toBe('    me@gmail.test');
                _l = testing_1.expect;
                return [4 /*yield*/, ui.find({ type: 'Text', text: /needs sign-in/ })];
            case 14:
                _l.apply(void 0, [(_y = (_1.sent())) === null || _y === void 0 ? void 0 : _y.text]).toBe('  needs sign-in');
                _m = testing_1.expect;
                return [4 /*yield*/, ui.find({ type: 'Text', text: /^  failed$/ })];
            case 15:
                _m.apply(void 0, [(_z = (_1.sent())) === null || _z === void 0 ? void 0 : _z.text]).toBe('  failed');
                _o = testing_1.expect;
                return [4 /*yield*/, ui.find({ type: 'Text', text: /checked \d\d:\d\d/ })];
            case 16:
                _o.apply(void 0, [(_0 = (_1.sent())) === null || _0 === void 0 ? void 0 : _0.text]).toMatch(/^  checked \d\d:\d\d  $/);
                return [4 /*yield*/, allText(ui)];
            case 17:
                text = _1.sent();
                (0, testing_1.expect)(text).toContain('Gmail');
                (0, testing_1.expect)(text).toContain('broken');
                (0, testing_1.expect)(text).not.toContain(SECRET);
                (0, testing_1.expect)(text).not.toContain('postgres');
                (0, testing_1.expect)(text).not.toContain('accessToken');
                // Within 5 minutes nothing runs again; the refresh button forces a check.
                return [4 /*yield*/, ui.press({ key: 'tab-list' })];
            case 18:
                // Within 5 minutes nothing runs again; the refresh button forces a check.
                _1.sent();
                return [4 /*yield*/, ui.press({ key: 'tab-connectors' })];
            case 19:
                _1.sent();
                (0, testing_1.expect)(ran.filter(function (r) { return r.argv[0] === 'claude' && r.argv[1] === 'mcp'; }).length).toBe(1);
                return [4 /*yield*/, ui.press({ key: 'c-refresh' })];
            case 20:
                _1.sent();
                (0, testing_1.expect)(ran.filter(function (r) { return r.argv[0] === 'claude' && r.argv[1] === 'mcp'; }).length).toBe(2);
                return [4 /*yield*/, ui.unmount()];
            case 21:
                _1.sent();
                return [2 /*return*/];
        }
    });
}); });
(0, testing_1.test)('a fresh shared cache is read, not refreshed', function ($, on) { return __awaiter(void 0, void 0, void 0, function () {
    var files, ran, ui, _a, _b;
    var _c;
    var _d, _e;
    return __generator(this, function (_f) {
        switch (_f.label) {
            case 0:
                files = (_c = {}, _c[SCRIPT] = (0, render_1.statusScript)(), _c[FLAG] = 'on\n', _c["".concat(HOME, "/").concat(connectors_1.CONN_CACHE_REL)] = "Gmail\tok\nCanva\tauth\n#checked\t".concat(Math.floor((NOW - 60000) / 1000), "\n"), _c);
                ran = panelWorld(on, files, DONE_FULL).ran;
                return [4 /*yield*/, $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })];
            case 1:
                _f.sent();
                return [4 /*yield*/, $.ui.mount({ plugin: 'progress-bar', surface: 'terminal', component: 'Pane', requestId: panel_1.PANE, props: PANE_PROPS })];
            case 2:
                ui = _f.sent();
                (0, testing_1.expect)(ran.some(function (r) { return r.argv[0] === 'claude'; })).toBe(false);
                _a = testing_1.expect;
                return [4 /*yield*/, ui.find({ type: 'Button', text: /Connectors/ })];
            case 3:
                _a.apply(void 0, [(_d = (_f.sent())) === null || _d === void 0 ? void 0 : _d.text]).toBe('  Connectors !1  ');
                return [4 /*yield*/, ui.press({ key: 'tab-connectors' })];
            case 4:
                _f.sent();
                _b = testing_1.expect;
                return [4 /*yield*/, ui.find({ type: 'Text', text: /CONNECTORS/ })];
            case 5:
                _b.apply(void 0, [(_e = (_f.sent())) === null || _e === void 0 ? void 0 : _e.text]).toBe('⚡ CONNECTORS  1 ok · 1 need sign-in');
                return [4 /*yield*/, ui.unmount()];
            case 6:
                _f.sent();
                return [2 /*return*/];
        }
    });
}); });
