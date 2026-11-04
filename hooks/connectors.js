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
exports.connsAtom = exports.CONN_EVERY = exports.CONN_ACCOUNTS_REL = exports.CONN_CACHE_REL = void 0;
exports.connName = connName;
exports.parseMcpList = parseMcpList;
exports.parseLogin = parseLogin;
exports.formatCache = formatCache;
exports.parseCache = parseCache;
exports.parseAccounts = parseAccounts;
exports.readConns = readConns;
exports.resetConns = resetConns;
exports.refreshConns = refreshConns;
exports.connSummary = connSummary;
var claude_code_1 = require("claude-code");
// The CONNECTORS section of the Status panel: each MCP server's name and status (ok, needs sign-in, failed).
// A refresh runs `claude mcp list` at most every 5 minutes, only while the panel is open, never two at once.
// The URL or command part of each line is dropped at parse time: it is never kept, cached or drawn,
// since it can hold credentials. Sessions share the result through ~/.cache/progress-bar/connectors.txt.
exports.CONN_CACHE_REL = '.cache/progress-bar/connectors.txt';
var CONN_LOCK_REL = '.cache/progress-bar/connectors.lock';
exports.CONN_ACCOUNTS_REL = '.claude-progress/connector-accounts.txt';
exports.CONN_EVERY = 5 * 60000;
var LOCK_MS = 2 * 60000;
exports.connsAtom = (0, claude_code_1.atom)({ plugin: 'progress-bar', key: 'conns' }, { at: 0, checking: false, login: '', list: [] });
var KINDS = new Set(['ok', 'auth', 'fail']);
/** A display name: no "claude.ai " prefix or " for creativity" suffix. '' when it looks like a URL or path. */
function connName(raw) {
    var name = raw.trim().replace(/^claude\.ai\s+/, '').replace(/\s+for creativity$/, '').trim();
    return /[/@:\t\n]/.test(name) ? '' : name;
}
/** Parses `claude mcp list` output into name + kind. The URL or command between them is discarded. */
function parseMcpList(stdout) {
    var out = [];
    for (var _i = 0, _a = stdout.split('\n'); _i < _a.length; _i++) {
        var line = _a[_i];
        var colon = line.indexOf(': ');
        var dash = line.lastIndexOf(' - ');
        if (colon <= 0 || dash <= colon)
            continue;
        var name_1 = connName(line.slice(0, colon));
        var status_1 = line.slice(dash + 3).replace(/^[^A-Za-z]+/, '').trim();
        if (!name_1 || !status_1)
            continue;
        var kind = /^connected\b/i.test(status_1) ? 'ok' : /auth|sign/i.test(status_1) ? 'auth' : 'fail';
        out.push({ name: name_1, kind: kind });
    }
    return out;
}
/** `claude auth status --json` -> "email · org", nothing else kept. '' when logged out or unreadable. */
function parseLogin(stdout) {
    try {
        var j = JSON.parse(stdout);
        if (j.loggedIn === false)
            return '';
        var clean = function (v) { return (typeof v === 'string' ? v.replace(/[\t\n\r]/g, ' ').trim() : ''); };
        return [clean(j.email), clean(j.orgName)].filter(Boolean).join(' · ');
    }
    catch (_a) {
        return '';
    }
}
/** The cache text: one "name<TAB>kind" line per connector, then "#login" and "#checked" (epoch seconds). */
function formatCache(list, login, atMs) {
    return __spreadArray(__spreadArray(__spreadArray([], list.map(function (c) { return "".concat(c.name, "\t").concat(c.kind); }), true), (login ? ["#login\t".concat(login)] : []), true), ["#checked\t".concat(Math.floor(atMs / 1000))], false).join('\n') + '\n';
}
function parseCache(raw) {
    var at = 0;
    var login = '';
    var list = [];
    for (var _i = 0, _a = raw.split('\n'); _i < _a.length; _i++) {
        var l = _a[_i];
        var _b = l.split('\t'), _c = _b[0], a = _c === void 0 ? '' : _c, _d = _b[1], b = _d === void 0 ? '' : _d;
        if (a === '#checked')
            at = Number(b) * 1000 || 0;
        else if (a === '#login')
            login = b.trim();
        else if (!a.startsWith('#') && KINDS.has(b)) {
            var name_2 = connName(a);
            if (name_2)
                list.push({ name: name_2, kind: b });
        }
    }
    return { at: at, login: login, list: list };
}
/** "name<TAB>account" lines; # starts a comment. */
function parseAccounts(raw) {
    var m = new Map();
    for (var _i = 0, _a = raw.split('\n'); _i < _a.length; _i++) {
        var l = _a[_i];
        if (!l.trim() || l.trim().startsWith('#'))
            continue;
        var _b = l.split('\t'), _c = _b[0], name_3 = _c === void 0 ? '' : _c, _d = _b[1], account = _d === void 0 ? '' : _d;
        if (name_3.trim() && account.trim())
            m.set(connName(name_3) || name_3.trim(), account.trim());
    }
    return m;
}
function readText($, path) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    _c.trys.push([0, 2, , 3]);
                    _a = String;
                    return [4 /*yield*/, $.fs.read(path)];
                case 1: return [2 /*return*/, _a.apply(void 0, [_c.sent()])];
                case 2:
                    _b = _c.sent();
                    return [2 /*return*/, ''];
                case 3: return [2 /*return*/];
            }
        });
    });
}
/** Reads the shared cache and the accounts file into the atom. Returns the last check time. */
function readConns($, h) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, at, login, list, _b, accounts, _c, withAcc, prev;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    _b = parseCache;
                    return [4 /*yield*/, readText($, "".concat(h, "/").concat(exports.CONN_CACHE_REL))];
                case 1:
                    _a = _b.apply(void 0, [_d.sent()]), at = _a.at, login = _a.login, list = _a.list;
                    _c = parseAccounts;
                    return [4 /*yield*/, readText($, "".concat(h, "/").concat(exports.CONN_ACCOUNTS_REL))];
                case 2:
                    accounts = _c.apply(void 0, [_d.sent()]);
                    withAcc = list.map(function (c) { var _a; return (__assign(__assign({}, c), { account: (_a = accounts.get(c.name)) !== null && _a !== void 0 ? _a : '' })); });
                    return [4 /*yield*/, (0, claude_code_1.read)($, exports.connsAtom)];
                case 3:
                    prev = _d.sent();
                    if (!(prev.at !== at || prev.login !== login || JSON.stringify(prev.list) !== JSON.stringify(withAcc))) return [3 /*break*/, 5];
                    return [4 /*yield*/, (0, claude_code_1.update)($, exports.connsAtom, function (c) { return (__assign(__assign({}, c), { at: at, login: login, list: withAcc })); })];
                case 4:
                    _d.sent();
                    _d.label = 5;
                case 5: return [2 /*return*/, at];
            }
        });
    });
}
var running = false;
/** Clears a "checking…" left over from before a reload. */
function resetConns($) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    running = false;
                    return [4 /*yield*/, (0, claude_code_1.update)($, exports.connsAtom, function (c) { return (__assign(__assign({}, c), { checking: false })); })];
                case 1:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
/** Refreshes when the cache is older than 5 minutes (or `force`), unless a check is already running here or in another session. */
function refreshConns($_1, h_1) {
    return __awaiter(this, arguments, void 0, function ($, h, force) {
        var at, now, lock, lockAt, _a, saved, opts, mcp, list, login, _b, _c, _d, _e, _f, _g, _h, _j;
        if (force === void 0) { force = false; }
        return __generator(this, function (_k) {
            switch (_k.label) {
                case 0:
                    if (!h || running)
                        return [2 /*return*/];
                    return [4 /*yield*/, readConns($, h)];
                case 1:
                    at = _k.sent();
                    return [4 /*yield*/, $.clock.now()];
                case 2:
                    now = _k.sent();
                    if (!force && now - at < exports.CONN_EVERY)
                        return [2 /*return*/];
                    lock = "".concat(h, "/").concat(CONN_LOCK_REL);
                    _a = Number;
                    return [4 /*yield*/, readText($, lock)];
                case 3:
                    lockAt = _a.apply(void 0, [(_k.sent()).trim()]) * 1000 || 0;
                    if (now - lockAt < LOCK_MS)
                        return [2 /*return*/];
                    running = true;
                    return [4 /*yield*/, (0, claude_code_1.update)($, exports.connsAtom, function (c) { return (__assign(__assign({}, c), { checking: true })); })];
                case 4:
                    _k.sent();
                    saved = false;
                    _k.label = 5;
                case 5:
                    _k.trys.push([5, 15, , 16]);
                    return [4 /*yield*/, $.fs.write(lock, "".concat(Math.floor(now / 1000), "\n"))];
                case 6:
                    _k.sent();
                    opts = { cwd: h, timeoutMs: 90000 };
                    return [4 /*yield*/, $.process.run(['claude', 'mcp', 'list'], opts)];
                case 7:
                    mcp = _k.sent();
                    list = parseMcpList(mcp.stdout);
                    login = '';
                    _k.label = 8;
                case 8:
                    _k.trys.push([8, 10, , 11]);
                    _b = parseLogin;
                    return [4 /*yield*/, $.process.run(['claude', 'auth', 'status', '--json'], opts)];
                case 9:
                    login = _b.apply(void 0, [(_k.sent()).stdout]);
                    return [3 /*break*/, 11];
                case 10:
                    _c = _k.sent();
                    login = '';
                    return [3 /*break*/, 11];
                case 11:
                    if (!(list.length || mcp.exitCode === 0)) return [3 /*break*/, 14];
                    _e = (_d = $.fs).write;
                    _f = ["".concat(h, "/").concat(exports.CONN_CACHE_REL)];
                    _g = formatCache;
                    _h = [list, login];
                    return [4 /*yield*/, $.clock.now()];
                case 12: return [4 /*yield*/, _e.apply(_d, _f.concat([_g.apply(void 0, _h.concat([_k.sent()]))]))];
                case 13:
                    _k.sent();
                    saved = true;
                    _k.label = 14;
                case 14: return [3 /*break*/, 16];
                case 15:
                    _j = _k.sent();
                    return [3 /*break*/, 16];
                case 16:
                    if (!saved) return [3 /*break*/, 18];
                    return [4 /*yield*/, $.process.run(['rm', '-f', lock]).catch(function () { return undefined; })];
                case 17:
                    _k.sent();
                    _k.label = 18;
                case 18:
                    running = false;
                    return [4 /*yield*/, (0, claude_code_1.update)($, exports.connsAtom, function (c) { return (__assign(__assign({}, c), { checking: false })); })];
                case 19:
                    _k.sent();
                    return [4 /*yield*/, readConns($, h)];
                case 20:
                    _k.sent();
                    return [2 /*return*/];
            }
        });
    });
}
/** "7 ok · 2 need sign-in · 1 failed" */
function connSummary(list) {
    var n = function (k) { return list.filter(function (c) { return c.kind === k; }).length; };
    return ["".concat(n('ok'), " ok"), n('auth') ? "".concat(n('auth'), " need sign-in") : '', n('fail') ? "".concat(n('fail'), " failed") : ''].filter(Boolean).join(' · ');
}
