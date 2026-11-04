"use strict";
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
exports.register = void 0;
var group_1 = require("./group");
var home_1 = require("./home");
var mac_1 = require("./mac");
var panel_1 = require("./panel");
var render_1 = require("./render");
var WATCH = '.watch.json';
var MAX_LOG = 4 * 1024 * 1024; // bigger logs are read from their last 4 MB
/** A row for one watch file, or null when its log is missing or the job is long over. */
function watchRow($, h, dir, name, now) {
    return __awaiter(this, void 0, void 0, function () {
        var w, _a, _b, _c, log, st, _d, text, _e, _f, _g, p, alive, _h, finished, state, startedAt, label;
        var _j, _k;
        return __generator(this, function (_l) {
            switch (_l.label) {
                case 0:
                    _l.trys.push([0, 2, , 3]);
                    _a = render_1.parseWatch;
                    _b = String;
                    return [4 /*yield*/, $.fs.read("".concat(dir, "/").concat(name))];
                case 1:
                    w = _a.apply(void 0, [_b.apply(void 0, [_l.sent()])]);
                    return [3 /*break*/, 3];
                case 2:
                    _c = _l.sent();
                    return [2 /*return*/, null];
                case 3:
                    if (!w)
                        return [2 /*return*/, null];
                    log = (0, render_1.expandHome)(w.log, h);
                    _l.label = 4;
                case 4:
                    _l.trys.push([4, 6, , 7]);
                    return [4 /*yield*/, $.fs.stat(log)];
                case 5:
                    st = _l.sent();
                    return [3 /*break*/, 7];
                case 6:
                    _d = _l.sent();
                    return [2 /*return*/, null];
                case 7:
                    text = '';
                    _l.label = 8;
                case 8:
                    _l.trys.push([8, 13, , 14]);
                    if (!(st.size > MAX_LOG)) return [3 /*break*/, 10];
                    return [4 /*yield*/, $.process.run(['tail', '-c', String(MAX_LOG), log])];
                case 9:
                    _e = (_l.sent()).stdout;
                    return [3 /*break*/, 12];
                case 10:
                    _f = String;
                    return [4 /*yield*/, $.fs.read(log)];
                case 11:
                    _e = _f.apply(void 0, [_l.sent()]);
                    _l.label = 12;
                case 12:
                    text = _e;
                    return [3 /*break*/, 14];
                case 13:
                    _g = _l.sent();
                    return [2 /*return*/, null];
                case 14:
                    p = (0, render_1.readLog)(w, text);
                    if (!w.process) return [3 /*break*/, 16];
                    return [4 /*yield*/, $.process.run(['pgrep', '-f', w.process]).catch(function () { return ({ exitCode: 1 }); })];
                case 15:
                    _h = (_l.sent()).exitCode === 0;
                    return [3 /*break*/, 17];
                case 16:
                    _h = null;
                    _l.label = 17;
                case 17:
                    alive = _h;
                    finished = p.done !== null && p.total !== null && p.done >= p.total;
                    state = p.error ? 'error' : finished ? 'done' : alive === false ? 'stopped' : 'running';
                    // A running job shows while its process lives or its log keeps changing; an ended one for FRESH_MS after its last write.
                    if (!(alive === true && !finished) && now - st.mtimeMs > render_1.FRESH_MS)
                        return [2 /*return*/, null];
                    startedAt = (_j = w.startedAt) !== null && _j !== void 0 ? _j : st.mtimeMs;
                    label = (_k = w.label) !== null && _k !== void 0 ? _k : name.slice(0, -WATCH.length);
                    return [2 /*return*/, { id: "watch:".concat(label), description: label, status: 'running', startedAt: startedAt, tools: 0, lastTool: '', done: p.done, total: p.total, step: p.step, state: state, eta: w.startedAt ? (0, render_1.eta)(now - w.startedAt, p.done, p.total) : '' }];
            }
        });
    });
}
// Subagents and shell jobs write { "done": 3, "total": 8, "step": "..." } to ~/.claude-progress/<slug>.json.
// This module turns them, plus every running subagent, into lines at ~/.claude-progress/.lines/agents-<session>.txt and jobs.txt,
// which the status line script from `/progress-bar setup` prints.
var LIVE = new Set(['pending', 'running', 'waiting']);
var SCRIPT_REL = '.claude/progress-bar/statusline.sh';
var GROUP_REL = '.claude/progress-bar/group.py';
var DEMO = 'progress-bar-demo';
var USAGE = [
    'Usage: /progress-bar [setup | demo | clear | todo | panel [on|off] | fold <section> | unfold <section> | toggle <section>]',
    '  panel: open the Status panel. panel on: open it at every session start, with a one-line status line',
    '  setup mac-clicks [off]: click a section header to fold it (macOS)',
    '  sections: todo, running, waiting, done, problems, all',
    '  todo: todo | todo add [name] <text> | todo done <n|text> | todo clear',
].join('\n');
var SECTIONS = ['todo', 'running', 'waiting', 'done', 'problems'];
var seen = new Map();
var dirOf = function (h) { return "".concat(h, "/.claude-progress"); };
function readP($, path) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, _b, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    _d.trys.push([0, 2, , 3]);
                    _a = render_1.parseProgress;
                    _b = String;
                    return [4 /*yield*/, $.fs.read(path)];
                case 1: return [2 /*return*/, _a.apply(void 0, [_b.apply(void 0, [_d.sent()])])];
                case 2:
                    _c = _d.sent();
                    return [2 /*return*/, null];
                case 3: return [2 /*return*/];
            }
        });
    });
}
/** Builds the rows: live subagents first, then every other fresh progress file. */
function collect($) {
    return __awaiter(this, void 0, void 0, function () {
        var h, dir, now, key, saved, _a, _b, _c, _i, _d, _e, id, v, _f, agents, _g, rows, _h, agents_1, a, s, p, _j, used, live, _k, stateFiles, _l, _m, stateFiles_1, f, _o, _p, _q, n, _r, files, _s, _t, files_1, f, r, name_1, p;
        var _u, _v, _w, _x, _y;
        return __generator(this, function (_z) {
            switch (_z.label) {
                case 0: return [4 /*yield*/, (0, home_1.resolveHome)($)];
                case 1:
                    h = _z.sent();
                    dir = dirOf(h);
                    return [4 /*yield*/, $.clock.now()];
                case 2:
                    now = _z.sent();
                    return [4 /*yield*/, sessionKeyOf($)];
                case 3:
                    key = _z.sent();
                    if (!(h && !seenLoaded)) return [3 /*break*/, 7];
                    seenLoaded = true;
                    _z.label = 4;
                case 4:
                    _z.trys.push([4, 6, , 7]);
                    _b = (_a = JSON).parse;
                    _c = String;
                    return [4 /*yield*/, $.fs.read("".concat(dir, "/.state/seen-").concat(key, ".json"))];
                case 5:
                    saved = _b.apply(_a, [_c.apply(void 0, [_z.sent()])]);
                    for (_i = 0, _d = Object.entries(saved); _i < _d.length; _i++) {
                        _e = _d[_i], id = _e[0], v = _e[1];
                        if (!seen.has(id))
                            seen.set(id, v);
                    }
                    return [3 /*break*/, 7];
                case 6:
                    _f = _z.sent();
                    return [3 /*break*/, 7];
                case 7:
                    agents = [];
                    _z.label = 8;
                case 8:
                    _z.trys.push([8, 10, , 11]);
                    return [4 /*yield*/, $.agent.list()];
                case 9:
                    agents = _z.sent();
                    return [3 /*break*/, 11];
                case 10:
                    _g = _z.sent();
                    agents = [];
                    return [3 /*break*/, 11];
                case 11:
                    rows = [];
                    _h = 0, agents_1 = agents;
                    _z.label = 12;
                case 12:
                    if (!(_h < agents_1.length)) return [3 /*break*/, 17];
                    a = agents_1[_h];
                    if (!LIVE.has(a.status))
                        return [3 /*break*/, 16];
                    s = (_u = seen.get(a.id)) !== null && _u !== void 0 ? _u : { startedAt: now, tools: 0, lastTool: '' };
                    seen.set(a.id, s);
                    if (!h) return [3 /*break*/, 14];
                    return [4 /*yield*/, readP($, "".concat(dir, "/").concat((0, render_1.slug)(a.description), ".json"))];
                case 13:
                    _j = _z.sent();
                    return [3 /*break*/, 15];
                case 14:
                    _j = null;
                    _z.label = 15;
                case 15:
                    p = _j;
                    rows.push({ id: a.id, description: a.description, status: a.status, startedAt: s.startedAt, tools: s.tools, lastTool: s.lastTool, done: (_v = p === null || p === void 0 ? void 0 : p.done) !== null && _v !== void 0 ? _v : null, total: (_w = p === null || p === void 0 ? void 0 : p.total) !== null && _w !== void 0 ? _w : null, step: (_x = p === null || p === void 0 ? void 0 : p.step) !== null && _x !== void 0 ? _x : '' });
                    _z.label = 16;
                case 16:
                    _h++;
                    return [3 /*break*/, 12];
                case 17:
                    if (!h)
                        return [2 /*return*/, { rows: rows, now: now }];
                    used = new Set(rows.map(function (r) { return (0, render_1.slug)(r.description); }));
                    _z.label = 18;
                case 18:
                    _z.trys.push([18, 21, , 22]);
                    live = Object.fromEntries(rows.map(function (r) { return [r.id, seen.get(r.id)]; }));
                    return [4 /*yield*/, $.fs.write("".concat(dir, "/.state/seen-").concat(key, ".json"), JSON.stringify(live))];
                case 19:
                    _z.sent();
                    return [4 /*yield*/, $.fs.write("".concat(dir, "/.state/claims-").concat(key, ".txt"), __spreadArray([], used, true).join('\n'))];
                case 20:
                    _z.sent();
                    return [3 /*break*/, 22];
                case 21:
                    _k = _z.sent();
                    return [3 /*break*/, 22];
                case 22:
                    stateFiles = [];
                    _z.label = 23;
                case 23:
                    _z.trys.push([23, 25, , 26]);
                    return [4 /*yield*/, $.fs.list("".concat(dir, "/.state"))];
                case 24:
                    stateFiles = _z.sent();
                    return [3 /*break*/, 26];
                case 25:
                    _l = _z.sent();
                    stateFiles = [];
                    return [3 /*break*/, 26];
                case 26:
                    _m = 0, stateFiles_1 = stateFiles;
                    _z.label = 27;
                case 27:
                    if (!(_m < stateFiles_1.length)) return [3 /*break*/, 35];
                    f = stateFiles_1[_m];
                    if (!f.name.startsWith('claims-') || f.name === "claims-".concat(key, ".txt") || now - f.mtimeMs > 30000)
                        return [3 /*break*/, 34];
                    _z.label = 28;
                case 28:
                    _z.trys.push([28, 33, , 34]);
                    _o = 0;
                    _q = String;
                    return [4 /*yield*/, $.fs.read("".concat(dir, "/.state/").concat(f.name))];
                case 29:
                    _p = _q.apply(void 0, [_z.sent()]).split('\n');
                    _z.label = 30;
                case 30:
                    if (!(_o < _p.length)) return [3 /*break*/, 32];
                    n = _p[_o];
                    if (n)
                        used.add(n);
                    _z.label = 31;
                case 31:
                    _o++;
                    return [3 /*break*/, 30];
                case 32: return [3 /*break*/, 34];
                case 33:
                    _r = _z.sent();
                    return [3 /*break*/, 34];
                case 34:
                    _m++;
                    return [3 /*break*/, 27];
                case 35:
                    files = [];
                    _z.label = 36;
                case 36:
                    _z.trys.push([36, 38, , 39]);
                    return [4 /*yield*/, $.fs.list(dir)];
                case 37:
                    files = _z.sent();
                    return [3 /*break*/, 39];
                case 38:
                    _s = _z.sent();
                    files = [];
                    return [3 /*break*/, 39];
                case 39:
                    _t = 0, files_1 = files;
                    _z.label = 40;
                case 40:
                    if (!(_t < files_1.length)) return [3 /*break*/, 45];
                    f = files_1[_t];
                    if (!(f.kind === 'file' && f.name.endsWith(WATCH))) return [3 /*break*/, 42];
                    return [4 /*yield*/, watchRow($, h, dir, f.name, now)];
                case 41:
                    r = _z.sent();
                    if (r)
                        rows.push(r);
                    return [3 /*break*/, 44];
                case 42:
                    if (f.kind !== 'file' || !f.name.endsWith('.json'))
                        return [3 /*break*/, 44];
                    name_1 = f.name.slice(0, -5);
                    if (used.has(name_1) || now - f.mtimeMs > render_1.FRESH_MS)
                        return [3 /*break*/, 44];
                    return [4 /*yield*/, readP($, "".concat(dir, "/").concat(f.name))];
                case 43:
                    p = _z.sent();
                    if (!p)
                        return [3 /*break*/, 44];
                    rows.push({ id: "file:".concat(name_1), description: name_1, status: 'running', startedAt: (_y = p.startedAt) !== null && _y !== void 0 ? _y : f.mtimeMs, tools: 0, lastTool: '', done: p.done, total: p.total, step: p.step });
                    _z.label = 44;
                case 44:
                    _t++;
                    return [3 /*break*/, 40];
                case 45: return [2 /*return*/, { rows: rows, now: now }];
            }
        });
    });
}
/** Folds or unfolds status line sections; the grouped status line shows a folded one as "▸ NAME (count)". */
function fold($, arg) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, verb, _b, what, h, file, cur, _c, _d, _e, targets, _i, targets_1, t;
        return __generator(this, function (_f) {
            switch (_f.label) {
                case 0:
                    _a = arg.split(/\s+/), verb = _a[0], _b = _a[1], what = _b === void 0 ? '' : _b;
                    return [4 /*yield*/, (0, home_1.resolveHome)($)];
                case 1:
                    h = _f.sent();
                    if (!h)
                        return [2 /*return*/, 'No home folder found.'];
                    file = "".concat(dirOf(h), "/.state/folded.txt");
                    cur = new Set();
                    _f.label = 2;
                case 2:
                    _f.trys.push([2, 4, , 5]);
                    _c = Set.bind;
                    _d = String;
                    return [4 /*yield*/, $.fs.read(file)];
                case 3:
                    cur = new (_c.apply(Set, [void 0, _d.apply(void 0, [_f.sent()]).split(/\s+/).filter(Boolean)]))();
                    return [3 /*break*/, 5];
                case 4:
                    _e = _f.sent();
                    return [3 /*break*/, 5];
                case 5:
                    targets = what === 'all' ? SECTIONS : SECTIONS.filter(function (x) { return x === what || (what === 'to-do' && x === 'todo'); });
                    if (!targets.length)
                        return [2 /*return*/, USAGE];
                    for (_i = 0, targets_1 = targets; _i < targets_1.length; _i++) {
                        t = targets_1[_i];
                        if (verb === 'fold' || (verb === 'toggle' && !cur.has(t)))
                            cur.add(t);
                        else
                            cur.delete(t);
                    }
                    return [4 /*yield*/, $.fs.write(file, __spreadArray([], cur, true).join('\n'))];
                case 6:
                    _f.sent();
                    return [2 /*return*/, cur.size ? "Folded: ".concat(__spreadArray([], cur, true).join(', '), ".") : 'All sections open.'];
            }
        });
    });
}
var sessionKey = '';
var seenLoaded = false;
function sessionKeyOf($) {
    return __awaiter(this, void 0, void 0, function () {
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (!!sessionKey) return [3 /*break*/, 4];
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, $.session.id()];
                case 2:
                    sessionKey = (_b.sent()).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12);
                    return [3 /*break*/, 4];
                case 3:
                    _a = _b.sent();
                    sessionKey = 'main';
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/, sessionKey];
            }
        });
    });
}
// Each session writes its own subagents to agents-<session>.txt, so two open sessions never overwrite each other.
// Job files (~/.claude-progress/*.json) are the same for every session, so they go to one shared jobs.txt.
function poll($) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, rows, now, home, agents, jobs, base, _b, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0: return [4 /*yield*/, collect($)];
                case 1:
                    _a = _d.sent(), rows = _a.rows, now = _a.now;
                    return [4 /*yield*/, (0, home_1.resolveHome)($)];
                case 2:
                    home = _d.sent();
                    if (!home)
                        return [2 /*return*/];
                    return [4 /*yield*/, sessionKeyOf($)];
                case 3:
                    _d.sent();
                    agents = rows.filter(function (r) { return !r.id.startsWith('file:'); });
                    jobs = rows.filter(function (r) { return r.id.startsWith('file:'); });
                    base = "".concat(dirOf(home), "/.lines");
                    _d.label = 4;
                case 4:
                    _d.trys.push([4, 6, , 7]);
                    return [4 /*yield*/, $.fs.write("".concat(base, "/agents-").concat(sessionKey, ".txt"), (0, render_1.lines)(agents, now).join('\n'))];
                case 5:
                    _d.sent();
                    return [3 /*break*/, 7];
                case 6:
                    _b = _d.sent();
                    return [3 /*break*/, 7];
                case 7:
                    _d.trys.push([7, 9, , 10]);
                    return [4 /*yield*/, $.fs.write("".concat(base, "/jobs.txt"), (0, render_1.lines)(jobs, now).join('\n'))];
                case 8:
                    _d.sent();
                    return [3 /*break*/, 10];
                case 9:
                    _c = _d.sent();
                    return [3 /*break*/, 10];
                case 10: return [2 /*return*/];
            }
        });
    });
}
function statusLineCommand($) {
    return __awaiter(this, void 0, void 0, function () {
        var v, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, $.settings.read({ key: 'statusLine' })];
                case 1:
                    v = (_b.sent());
                    return [2 /*return*/, v && v.type === 'command' && typeof v.command === 'string' ? v.command : undefined];
                case 2:
                    _a = _b.sent();
                    return [2 /*return*/, undefined];
                case 3: return [2 /*return*/];
            }
        });
    });
}
var snippet = "\"statusLine\": { \"type\": \"command\", \"command\": \"~/".concat(SCRIPT_REL, "\", \"refreshInterval\": 1 }");
function show($) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, rows, now, h, current, installed, _b, wired, bars, setup;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: return [4 /*yield*/, collect($)];
                case 1:
                    _a = _c.sent(), rows = _a.rows, now = _a.now;
                    return [4 /*yield*/, (0, home_1.resolveHome)($)];
                case 2:
                    h = _c.sent();
                    return [4 /*yield*/, statusLineCommand($)];
                case 3:
                    current = _c.sent();
                    if (!h) return [3 /*break*/, 5];
                    return [4 /*yield*/, $.fs.exists("".concat(h, "/").concat(SCRIPT_REL)).catch(function () { return false; })];
                case 4:
                    _b = _c.sent();
                    return [3 /*break*/, 6];
                case 5:
                    _b = false;
                    _c.label = 6;
                case 6:
                    installed = _b;
                    wired = !!current && current.includes(SCRIPT_REL);
                    bars = rows.length ? (0, render_1.lines)(rows, now).join('\n') : 'No running jobs. Try `/progress-bar demo`.';
                    setup = wired
                        ? 'Status line: on.'
                        : installed
                            ? "Status line: script installed, not in settings yet. Add to ~/.claude/settings.json:\n  ".concat(snippet)
                            : 'Status line: off. Run `/progress-bar setup`.';
                    return [2 /*return*/, "".concat(bars, "\n\n").concat(setup)];
            }
        });
    });
}
function setup($) {
    return __awaiter(this, void 0, void 0, function () {
        var h, current, path, prev, _a, chain, done;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, (0, home_1.resolveHome)($)];
                case 1:
                    h = _b.sent();
                    if (!h)
                        return [2 /*return*/, 'Could not find your home folder ($HOME is unset).'];
                    return [4 /*yield*/, statusLineCommand($)];
                case 2:
                    current = _b.sent();
                    path = "".concat(h, "/").concat(SCRIPT_REL);
                    if (!(current && !current.includes(SCRIPT_REL))) return [3 /*break*/, 3];
                    _a = current;
                    return [3 /*break*/, 5];
                case 3: return [4 /*yield*/, installedPrev($, path)];
                case 4:
                    _a = _b.sent();
                    _b.label = 5;
                case 5:
                    prev = _a;
                    return [4 /*yield*/, $.fs.write(path, (0, render_1.statusScript)(prev))];
                case 6:
                    _b.sent();
                    return [4 /*yield*/, $.fs.write("".concat(h, "/").concat(GROUP_REL), group_1.GROUP_PY)];
                case 7:
                    _b.sent();
                    return [4 /*yield*/, $.process.run(['chmod', '+x', path]).catch(function () { return undefined; })];
                case 8:
                    _b.sent();
                    chain = prev ? "\nIt runs your current status line after the bars: ".concat(prev) : '';
                    done = (current === null || current === void 0 ? void 0 : current.includes(SCRIPT_REL))
                        ? 'Your settings already point at it.'
                        : "Add this to ~/.claude/settings.json (replacing any \"statusLine\" there):\n  ".concat(snippet);
                    return [2 /*return*/, "Wrote ".concat(path, " and group.py beside it.").concat(chain, "\n").concat(done, "\n\"refreshInterval\": 1 redraws the status line every second.")];
            }
        });
    });
}
/** The command an installed script chains, so running setup again keeps it. */
function installedPrev($, path) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, _b, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    _d.trys.push([0, 2, , 3]);
                    _a = render_1.prevOf;
                    _b = String;
                    return [4 /*yield*/, $.fs.read(path)];
                case 1: return [2 /*return*/, _a.apply(void 0, [_b.apply(void 0, [_d.sent()])])];
                case 2:
                    _c = _d.sent();
                    return [2 /*return*/, undefined];
                case 3: return [2 /*return*/];
            }
        });
    });
}
/** Rewrites an installed script and group.py with this version's, keeping the chained command. No-op when not installed. */
function refreshInstalled($) {
    return __awaiter(this, void 0, void 0, function () {
        var h, path, _a, _b, _c, _d, _e;
        return __generator(this, function (_f) {
            switch (_f.label) {
                case 0: return [4 /*yield*/, (0, home_1.resolveHome)($)];
                case 1:
                    h = _f.sent();
                    path = "".concat(h, "/").concat(SCRIPT_REL);
                    _a = !h;
                    if (_a) return [3 /*break*/, 3];
                    return [4 /*yield*/, $.fs.exists(path).catch(function () { return false; })];
                case 2:
                    _a = !(_f.sent());
                    _f.label = 3;
                case 3:
                    if (_a)
                        return [2 /*return*/];
                    _c = (_b = $.fs).write;
                    _d = [path];
                    _e = render_1.statusScript;
                    return [4 /*yield*/, installedPrev($, path)];
                case 4: return [4 /*yield*/, _c.apply(_b, _d.concat([_e.apply(void 0, [_f.sent()])]))];
                case 5:
                    _f.sent();
                    return [4 /*yield*/, $.fs.write("".concat(h, "/").concat(GROUP_REL), group_1.GROUP_PY)];
                case 6:
                    _f.sent();
                    return [2 /*return*/];
            }
        });
    });
}
/** `/progress-bar panel [on|off]`: the panel runs the installed script, so it needs setup first. */
function panel($, arg) {
    return __awaiter(this, void 0, void 0, function () {
        var h, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, (0, home_1.resolveHome)($)];
                case 1:
                    h = _b.sent();
                    _a = h && arg !== 'off';
                    if (!_a) return [3 /*break*/, 3];
                    return [4 /*yield*/, $.fs.exists("".concat(h, "/").concat(SCRIPT_REL)).catch(function () { return false; })];
                case 2:
                    _a = !(_b.sent());
                    _b.label = 3;
                case 3:
                    if (_a)
                        return [2 /*return*/, 'The Status panel draws the status line script. Run `/progress-bar setup` first.'];
                    if (!(arg === 'on')) return [3 /*break*/, 5];
                    return [4 /*yield*/, refreshInstalled($)];
                case 4:
                    _b.sent();
                    _b.label = 5;
                case 5: return [2 /*return*/, (0, panel_1.panelCommand)($, h, arg)];
            }
        });
    });
}
/** `/progress-bar setup mac-clicks [off]`: also refreshes group.py, which draws the header links. */
function setupMacClicks($, mode) {
    return __awaiter(this, void 0, void 0, function () {
        var h, text;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, (0, home_1.resolveHome)($)];
                case 1:
                    h = _a.sent();
                    if (!h)
                        return [2 /*return*/, 'Could not find your home folder ($HOME is unset).'];
                    return [4 /*yield*/, (0, mac_1.macClicks)($, h, mode)];
                case 2:
                    text = _a.sent();
                    if (!(mode === 'on' && text.startsWith('Click to fold is on'))) return [3 /*break*/, 4];
                    return [4 /*yield*/, $.fs.write("".concat(h, "/").concat(GROUP_REL), group_1.GROUP_PY)];
                case 3:
                    _a.sent();
                    _a.label = 4;
                case 4: return [2 /*return*/, text];
            }
        });
    });
}
/** `/progress-bar todo ...`: list, add, done, clear in ~/.claude-progress/todo.txt. */
function todo($, rest) {
    return __awaiter(this, void 0, void 0, function () {
        var h, file, text, _a, _b, _c, _d, verb, more, arg, _e, r, r, r;
        return __generator(this, function (_f) {
            switch (_f.label) {
                case 0: return [4 /*yield*/, (0, home_1.resolveHome)($)];
                case 1:
                    h = _f.sent();
                    if (!h)
                        return [2 /*return*/, 'Could not find your home folder ($HOME is unset).'];
                    file = "".concat(dirOf(h), "/todo.txt");
                    text = '';
                    _f.label = 2;
                case 2:
                    _f.trys.push([2, 4, , 5]);
                    _a = String;
                    return [4 /*yield*/, $.fs.read(file)];
                case 3:
                    text = _a.apply(void 0, [_f.sent()]);
                    return [3 /*break*/, 5];
                case 4:
                    _b = _f.sent();
                    return [3 /*break*/, 5];
                case 5:
                    _c = rest.split(/\s+/), _d = _c[0], verb = _d === void 0 ? '' : _d, more = _c.slice(1);
                    arg = rest.slice(verb.length).trim();
                    _e = verb.toLowerCase();
                    switch (_e) {
                        case '': return [3 /*break*/, 6];
                        case 'list': return [3 /*break*/, 6];
                        case 'add': return [3 /*break*/, 7];
                        case 'done': return [3 /*break*/, 9];
                        case 'clear': return [3 /*break*/, 11];
                    }
                    return [3 /*break*/, 14];
                case 6: return [2 /*return*/, (0, render_1.todoList)(text)];
                case 7:
                    if (!arg || /^\[[^\]]+\]$/.test(arg))
                        return [2 /*return*/, 'Usage: /progress-bar todo add [name] <text>'];
                    r = (0, render_1.todoAdd)(text, arg);
                    return [4 /*yield*/, $.fs.write(file, r.text)];
                case 8:
                    _f.sent();
                    return [2 /*return*/, "Added to [".concat(r.heading, "].\n").concat((0, render_1.todoList)(r.text))];
                case 9:
                    if (!more.length)
                        return [2 /*return*/, 'Usage: /progress-bar todo done <n|text>'];
                    r = (0, render_1.todoDone)(text, arg);
                    if (!r)
                        return [2 /*return*/, "No open to-do matches \"".concat(arg, "\".\n").concat((0, render_1.todoList)(text))];
                    return [4 /*yield*/, $.fs.write(file, r.text)];
                case 10:
                    _f.sent();
                    return [2 /*return*/, "Done: ".concat(r.item.text)];
                case 11:
                    r = (0, render_1.todoClear)(text);
                    if (!r.removed) return [3 /*break*/, 13];
                    return [4 /*yield*/, $.fs.write(file, r.text)];
                case 12:
                    _f.sent();
                    _f.label = 13;
                case 13: return [2 /*return*/, r.removed ? "Removed ".concat(r.removed, " done item").concat(r.removed === 1 ? '' : 's', ".") : 'Nothing done to clear.'];
                case 14: return [2 /*return*/, USAGE];
            }
        });
    });
}
function demo($) {
    return __awaiter(this, void 0, void 0, function () {
        var h, path, startedAt, total, done, write, tick;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, (0, home_1.resolveHome)($)];
                case 1:
                    h = _a.sent();
                    if (!h)
                        return [2 /*return*/, 'Could not find your home folder ($HOME is unset).'];
                    path = "".concat(dirOf(h), "/").concat(DEMO, ".json");
                    return [4 /*yield*/, $.clock.now()];
                case 2:
                    startedAt = _a.sent();
                    total = 20;
                    done = 0;
                    write = function () { return $.fs.write(path, JSON.stringify({ done: done, total: total, step: "demo step ".concat(done), startedAt: startedAt })); };
                    return [4 /*yield*/, write()];
                case 3:
                    _a.sent();
                    tick = $.clock.every(1000, function () { return __awaiter(_this, void 0, void 0, function () {
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0:
                                    done += 1;
                                    if (!(done > total)) return [3 /*break*/, 2];
                                    tick.cancel();
                                    return [4 /*yield*/, $.process.run(['rm', '-f', path]).catch(function () { return undefined; })];
                                case 1:
                                    _a.sent();
                                    return [2 /*return*/];
                                case 2: return [4 /*yield*/, write()];
                                case 3:
                                    _a.sent();
                                    return [4 /*yield*/, poll($)];
                                case 4:
                                    _a.sent();
                                    return [2 /*return*/];
                            }
                        });
                    }); });
                    return [4 /*yield*/, poll($)];
                case 4:
                    _a.sent();
                    return [2 /*return*/, "Demo job started: ".concat(path, " counts to ").concat(total, " over 20 s, then deletes itself.")];
            }
        });
    });
}
function clear($) {
    return __awaiter(this, void 0, void 0, function () {
        var h, now, dir, stale, _i, _a, _b, sub, maxAge, files, _c, _d, files_2, f, _e;
        return __generator(this, function (_f) {
            switch (_f.label) {
                case 0: return [4 /*yield*/, (0, home_1.resolveHome)($)];
                case 1:
                    h = _f.sent();
                    if (!h)
                        return [2 /*return*/, 'Could not find your home folder ($HOME is unset).'];
                    return [4 /*yield*/, $.clock.now()];
                case 2:
                    now = _f.sent();
                    dir = dirOf(h);
                    stale = [];
                    _i = 0, _a = [['', render_1.FRESH_MS], ['/.lines', 2 * 60000]];
                    _f.label = 3;
                case 3:
                    if (!(_i < _a.length)) return [3 /*break*/, 13];
                    _b = _a[_i], sub = _b[0], maxAge = _b[1];
                    files = [];
                    _f.label = 4;
                case 4:
                    _f.trys.push([4, 6, , 7]);
                    return [4 /*yield*/, $.fs.list(dir + sub)];
                case 5:
                    files = _f.sent();
                    return [3 /*break*/, 7];
                case 6:
                    _c = _f.sent();
                    files = [];
                    return [3 /*break*/, 7];
                case 7:
                    _d = 0, files_2 = files;
                    _f.label = 8;
                case 8:
                    if (!(_d < files_2.length)) return [3 /*break*/, 12];
                    f = files_2[_d];
                    if (f.kind !== 'file' || !/\.(json|txt)$/.test(f.name) || now - f.mtimeMs <= maxAge)
                        return [3 /*break*/, 11];
                    _e = sub === '' && f.name.endsWith(WATCH);
                    if (!_e) return [3 /*break*/, 10];
                    return [4 /*yield*/, watchRow($, h, dir, f.name, now)];
                case 9:
                    _e = (_f.sent());
                    _f.label = 10;
                case 10:
                    // A watch file is written once; it is stale only when its job no longer shows.
                    if (_e)
                        return [3 /*break*/, 11];
                    stale.push("".concat(dir).concat(sub, "/").concat(f.name));
                    _f.label = 11;
                case 11:
                    _d++;
                    return [3 /*break*/, 8];
                case 12:
                    _i++;
                    return [3 /*break*/, 3];
                case 13:
                    if (!stale.length) return [3 /*break*/, 15];
                    return [4 /*yield*/, $.process.run(__spreadArray(['rm', '-f'], stale, true)).catch(function () { return undefined; })];
                case 14:
                    _f.sent();
                    _f.label = 15;
                case 15: return [2 /*return*/, stale.length ? "Removed ".concat(stale.length, " stale file").concat(stale.length === 1 ? '' : 's', ".") : 'Nothing stale.'];
            }
        });
    });
}
var register = function (on) {
    (0, panel_1.registerPanel)(on);
    on('tool.call', function ($, e, next) { return __awaiter(void 0, void 0, void 0, function () {
        var s, _a;
        var _b;
        var _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    if (!e.agentId) return [3 /*break*/, 4];
                    if (!((_c = seen.get(e.agentId)) !== null && _c !== void 0)) return [3 /*break*/, 1];
                    _a = _c;
                    return [3 /*break*/, 3];
                case 1:
                    _b = {};
                    return [4 /*yield*/, $.clock.now()];
                case 2:
                    _a = (_b.startedAt = _d.sent(), _b.tools = 0, _b.lastTool = '', _b);
                    _d.label = 3;
                case 3:
                    s = _a;
                    s.tools += 1;
                    s.lastTool = String(e.tool);
                    seen.set(e.agentId, s);
                    _d.label = 4;
                case 4: return [2 /*return*/, next(e)];
            }
        });
    }); });
    on('session.start', function ($, e, next) { return __awaiter(void 0, void 0, void 0, function () {
        var _a, _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: return [4 /*yield*/, $.command.register({ name: 'progress-bar', description: 'Show live progress bars, or set up the status line', argumentHint: '[setup [mac-clicks [off]] | demo | clear | todo | panel [on|off] | fold <section>]' })];
                case 1:
                    _c.sent();
                    void poll($);
                    $.clock.every(5000, function () { void poll($); });
                    _a = panel_1.startPanel;
                    _b = [$];
                    return [4 /*yield*/, (0, home_1.resolveHome)($)];
                case 2: return [4 /*yield*/, _a.apply(void 0, _b.concat([_c.sent()]))];
                case 3:
                    _c.sent();
                    return [2 /*return*/, next(e)];
            }
        });
    }); });
    on('command.run', { command: 'progress-bar' }, function ($, e) { return __awaiter(void 0, void 0, void 0, function () {
        var raw, arg, text, _a, _b, _c, _d, _e, _f, _g, _h;
        var _j;
        return __generator(this, function (_k) {
            switch (_k.label) {
                case 0:
                    raw = ((_j = e.args) !== null && _j !== void 0 ? _j : '').trim();
                    arg = raw.toLowerCase();
                    if (!(arg === '')) return [3 /*break*/, 2];
                    return [4 /*yield*/, show($)];
                case 1:
                    _a = _k.sent();
                    return [3 /*break*/, 24];
                case 2:
                    if (!(arg === 'setup')) return [3 /*break*/, 4];
                    return [4 /*yield*/, setup($)];
                case 3:
                    _b = _k.sent();
                    return [3 /*break*/, 23];
                case 4:
                    if (!(arg.startsWith('setup ') && (0, mac_1.parseMacClicks)(arg.slice(6)))) return [3 /*break*/, 6];
                    return [4 /*yield*/, setupMacClicks($, (0, mac_1.parseMacClicks)(arg.slice(6)))];
                case 5:
                    _c = _k.sent();
                    return [3 /*break*/, 22];
                case 6:
                    if (!(arg === 'demo')) return [3 /*break*/, 8];
                    return [4 /*yield*/, demo($)];
                case 7:
                    _d = _k.sent();
                    return [3 /*break*/, 21];
                case 8:
                    if (!(arg === 'clear')) return [3 /*break*/, 10];
                    return [4 /*yield*/, clear($)];
                case 9:
                    _e = _k.sent();
                    return [3 /*break*/, 20];
                case 10:
                    if (!/^panel\b/.test(arg)) return [3 /*break*/, 12];
                    return [4 /*yield*/, panel($, arg.slice(5).trim())];
                case 11:
                    _f = _k.sent();
                    return [3 /*break*/, 19];
                case 12:
                    if (!/^todo\b/.test(arg)) return [3 /*break*/, 14];
                    return [4 /*yield*/, todo($, raw.slice(4).trim())];
                case 13:
                    _g = _k.sent();
                    return [3 /*break*/, 18];
                case 14:
                    if (!/^(fold|unfold|toggle)\b/.test(arg)) return [3 /*break*/, 16];
                    return [4 /*yield*/, fold($, arg)];
                case 15:
                    _h = _k.sent();
                    return [3 /*break*/, 17];
                case 16:
                    _h = USAGE;
                    _k.label = 17;
                case 17:
                    _g = _h;
                    _k.label = 18;
                case 18:
                    _f = _g;
                    _k.label = 19;
                case 19:
                    _e = _f;
                    _k.label = 20;
                case 20:
                    _d = _e;
                    _k.label = 21;
                case 21:
                    _c = _d;
                    _k.label = 22;
                case 22:
                    _b = _c;
                    _k.label = 23;
                case 23:
                    _a = _b;
                    _k.label = 24;
                case 24:
                    text = _a;
                    return [2 /*return*/, { text: text }];
            }
        });
    }); });
};
exports.register = register;
