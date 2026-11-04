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
exports.ghAtom = exports.GH_EVERY = exports.REPOS_REL = void 0;
exports.webUrl = webUrl;
exports.parseBranches = parseBranches;
exports.parseCommits = parseCommits;
exports.readRepo = readRepo;
exports.readGh = readGh;
exports.openUrl = openUrl;
var claude_code_1 = require("claude-code");
var mac_1 = require("./mac");
// The GITHUB tab of the Status panel: branches and recent commits of the session's repo,
// plus any folders listed in ~/.claude-progress/repos.txt (optional, one path per line).
// Read with plain local git (no network, no token). A press opens the matching GitHub page,
// and only https://github.com/ URLs are ever opened. Credentials in an https remote are dropped.
exports.REPOS_REL = '.claude-progress/repos.txt';
exports.GH_EVERY = 30000;
exports.ghAtom = (0, claude_code_1.atom)({ plugin: 'progress-bar', key: 'gh' }, { repos: [], sel: 0, at: 0 });
function git($, cwd, args) {
    return __awaiter(this, void 0, void 0, function () {
        var r, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, $.process.run(__spreadArray(['git', '-C', cwd], args, true), { timeoutMs: 8000 })];
                case 1:
                    r = _b.sent();
                    return [2 /*return*/, r.exitCode === 0 ? r.stdout : ''];
                case 2:
                    _a = _b.sent();
                    return [2 /*return*/, ''];
                case 3: return [2 /*return*/];
            }
        });
    });
}
/** An origin remote as https://github.com/<owner>/<repo>, '' when it is not on GitHub. Never keeps credentials. */
function webUrl(remote) {
    var r = remote.trim().replace(/^(https?|ssh):\/\/[^@/]*@/, '$1://');
    var m = /^(?:https?:\/\/github\.com\/|ssh:\/\/github\.com\/|git@github\.com:)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(r);
    return m ? "https://github.com/".concat(m[1], "/").concat(m[2]) : '';
}
/** for-each-ref lines "HEAD\x1fname\x1ftrack" -> branches with ahead/behind. */
function parseBranches(out) {
    return out.split('\n').filter(function (l) { return l.includes('\x1f'); }).map(function (l) {
        var _a, _b, _c, _d;
        var _e = l.split('\x1f'), _f = _e[0], h = _f === void 0 ? '' : _f, _g = _e[1], name = _g === void 0 ? '' : _g, _h = _e[2], track = _h === void 0 ? '' : _h;
        return { name: name, current: h === '*', ahead: Number((_b = (_a = /ahead (\d+)/.exec(track)) === null || _a === void 0 ? void 0 : _a[1]) !== null && _b !== void 0 ? _b : 0), behind: Number((_d = (_c = /behind (\d+)/.exec(track)) === null || _c === void 0 ? void 0 : _c[1]) !== null && _d !== void 0 ? _d : 0) };
    });
}
/** log lines "sha\x1fsubject\x1fwhen\x1fauthor" -> commits. */
function parseCommits(out) {
    return out.split('\n').filter(function (l) { return l.includes('\x1f'); }).map(function (l) {
        var _a = l.split('\x1f'), _b = _a[0], sha = _b === void 0 ? '' : _b, _c = _a[1], subject = _c === void 0 ? '' : _c, _d = _a[2], when = _d === void 0 ? '' : _d, _e = _a[3], author = _e === void 0 ? '' : _e;
        return { sha: sha, subject: subject, when: when.replace(/ ago$/, ''), author: author };
    });
}
/** One repo read with local git, null when the folder is not in a repo. */
function readRepo($, path) {
    return __awaiter(this, void 0, void 0, function () {
        var top, url, _a, branch, dirty, branches, _b, commits, _c, cur;
        var _d, _e;
        return __generator(this, function (_f) {
            switch (_f.label) {
                case 0: return [4 /*yield*/, git($, path, ['rev-parse', '--show-toplevel'])];
                case 1:
                    top = (_f.sent()).trim();
                    if (!top)
                        return [2 /*return*/, null];
                    _a = webUrl;
                    return [4 /*yield*/, git($, top, ['remote', 'get-url', 'origin'])];
                case 2:
                    url = _a.apply(void 0, [_f.sent()]);
                    return [4 /*yield*/, git($, top, ['branch', '--show-current'])];
                case 3:
                    branch = (_f.sent()).trim() || '(detached)';
                    return [4 /*yield*/, git($, top, ['status', '--porcelain'])];
                case 4:
                    dirty = (_f.sent()).split('\n').filter(Boolean).length;
                    _b = parseBranches;
                    return [4 /*yield*/, git($, top, ['for-each-ref', '--sort=-committerdate', '--count=8', '--format=%(HEAD)%1f%(refname:short)%1f%(upstream:track,nobracket)', 'refs/heads'])];
                case 5:
                    branches = _b.apply(void 0, [_f.sent()]);
                    _c = parseCommits;
                    return [4 /*yield*/, git($, top, ['log', '-8', '--format=%h%x1f%s%x1f%cr%x1f%an'])];
                case 6:
                    commits = _c.apply(void 0, [_f.sent()]);
                    cur = branches.find(function (b) { return b.current; });
                    return [2 /*return*/, { name: top.split('/').pop() || top, path: top, url: url, branch: branch, dirty: dirty, ahead: (_d = cur === null || cur === void 0 ? void 0 : cur.ahead) !== null && _d !== void 0 ? _d : 0, behind: (_e = cur === null || cur === void 0 ? void 0 : cur.behind) !== null && _e !== void 0 ? _e : 0, branches: branches, commits: commits }];
            }
        });
    });
}
/** Reads the session's repo first, then each folder in repos.txt, once each. */
function readGh($, h) {
    return __awaiter(this, void 0, void 0, function () {
        var list, _a, _b, cwd, seen, repos, _i, _c, p, r, now;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    list = [];
                    _d.label = 1;
                case 1:
                    _d.trys.push([1, 3, , 4]);
                    _a = String;
                    return [4 /*yield*/, $.fs.read("".concat(h, "/").concat(exports.REPOS_REL))];
                case 2:
                    list = _a.apply(void 0, [_d.sent()]).split('\n').map(function (l) { return l.trim(); }).filter(function (l) { return l && !l.startsWith('#'); });
                    return [3 /*break*/, 4];
                case 3:
                    _b = _d.sent();
                    list = [];
                    return [3 /*break*/, 4];
                case 4: return [4 /*yield*/, $.session.cwd().catch(function () { return ''; })];
                case 5:
                    cwd = _d.sent();
                    seen = new Set();
                    repos = [];
                    _i = 0, _c = __spreadArray([cwd], list.map(function (l) { return l.replace(/^~(?=\/|$)/, h); }), true);
                    _d.label = 6;
                case 6:
                    if (!(_i < _c.length)) return [3 /*break*/, 9];
                    p = _c[_i];
                    if (!p)
                        return [3 /*break*/, 8];
                    return [4 /*yield*/, readRepo($, p)];
                case 7:
                    r = _d.sent();
                    if (r && !seen.has(r.path)) {
                        seen.add(r.path);
                        repos.push(r);
                    }
                    _d.label = 8;
                case 8:
                    _i++;
                    return [3 /*break*/, 6];
                case 9: return [4 /*yield*/, $.clock.now()];
                case 10:
                    now = _d.sent();
                    return [4 /*yield*/, (0, claude_code_1.update)($, exports.ghAtom, function (g) { return ({ repos: repos, sel: Math.min(g.sel, Math.max(0, repos.length - 1)), at: now }); })];
                case 11:
                    _d.sent();
                    return [2 /*return*/];
            }
        });
    });
}
/** Opens a GitHub page in the browser: `open` on macOS, `xdg-open` elsewhere. Anything else is ignored. */
function openUrl($, url) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, _b, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    if (!/^https:\/\/github\.com\/[^\s@]+$/.test(url))
                        return [2 /*return*/];
                    _d.label = 1;
                case 1:
                    _d.trys.push([1, 4, , 5]);
                    _b = (_a = $.process).run;
                    return [4 /*yield*/, (0, mac_1.isDarwin)($)];
                case 2: return [4 /*yield*/, _b.apply(_a, [[(_d.sent()) ? 'open' : 'xdg-open', url], { timeoutMs: 5000 }])];
                case 3:
                    _d.sent();
                    return [3 /*break*/, 5];
                case 4:
                    _c = _d.sent();
                    return [3 /*break*/, 5];
                case 5: return [2 /*return*/];
            }
        });
    });
}
