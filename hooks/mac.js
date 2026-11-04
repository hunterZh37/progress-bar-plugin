"use strict";
var __makeTemplateObject = (this && this.__makeTemplateObject) || function (cooked, raw) {
    if (Object.defineProperty) { Object.defineProperty(cooked, "raw", { value: raw }); } else { cooked.raw = raw; }
    return cooked;
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.NOT_MAC = exports.PLIST_COMMANDS = exports.TOGGLE_APPLESCRIPT = exports.LSREGISTER = exports.BUNDLE_ID = exports.CLICKS_REL = exports.SCRIPT_REL = exports.APP_REL = void 0;
exports.parseMacClicks = parseMacClicks;
exports.isDarwin = isDarwin;
exports.macClicks = macClicks;
// `/progress-bar setup mac-clicks`: a tiny AppleScript app that owns the progressbar:// URL scheme.
// Clicking a section header (an OSC 8 link to progressbar://toggle/<section>) flips that section in folded.txt.
exports.APP_REL = 'Applications/ProgressBarToggle.app';
exports.SCRIPT_REL = '.claude/progress-bar/ProgressBarToggle.applescript';
exports.CLICKS_REL = '.claude-progress/.state/clicks-on';
exports.BUNDLE_ID = 'com.hunterzh37.progressbar-toggle';
exports.LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
var PLISTBUDDY = '/usr/libexec/PlistBuddy';
/** Only these section keys are ever written, so a crafted URL cannot put anything else in folded.txt. */
exports.TOGGLE_APPLESCRIPT = String.raw(templateObject_1 || (templateObject_1 = __makeTemplateObject(["on open location theURL\n\tset sec to do shell script \"printf %s \" & quoted form of theURL & \" | sed -E 's#^progressbar://(toggle/)?##; s#[^a-z-].*##'\"\n\tif sec is \"to-do\" then set sec to \"todo\"\n\tif sec is in {\"todo\", \"running\", \"waiting\", \"done\", \"problems\"} then\n\t\tdo shell script \"f=$HOME/.claude-progress/.state/folded.txt; mkdir -p \"$(dirname $f)\"; touch $f; if grep -qx \" & quoted form of sec & \" $f; then grep -vx \" & quoted form of sec & \" $f > $f.tmp; mv $f.tmp $f; else echo \" & quoted form of sec & \" >> $f; fi\"\n\tend if\nend open location\n"], ["on open location theURL\n\tset sec to do shell script \"printf %s \" & quoted form of theURL & \" | sed -E 's#^progressbar://(toggle/)?##; s#[^a-z-].*##'\"\n\tif sec is \"to-do\" then set sec to \"todo\"\n\tif sec is in {\"todo\", \"running\", \"waiting\", \"done\", \"problems\"} then\n\t\tdo shell script \"f=$HOME/.claude-progress/.state/folded.txt; mkdir -p \\\"$(dirname $f)\\\"; touch $f; if grep -qx \" & quoted form of sec & \" $f; then grep -vx \" & quoted form of sec & \" $f > $f.tmp; mv $f.tmp $f; else echo \" & quoted form of sec & \" >> $f; fi\"\n\tend if\nend open location\n"
    /** PlistBuddy commands that give the app its bundle id, hide it from the Dock and claim progressbar://. */
])));
/** PlistBuddy commands that give the app its bundle id, hide it from the Dock and claim progressbar://. */
exports.PLIST_COMMANDS = [
    "Set :CFBundleIdentifier ".concat(exports.BUNDLE_ID),
    'Add :LSUIElement bool true',
    'Add :CFBundleURLTypes array',
    'Add :CFBundleURLTypes:0 dict',
    'Add :CFBundleURLTypes:0:CFBundleURLName string ProgressBar toggle',
    'Add :CFBundleURLTypes:0:CFBundleURLSchemes array',
    'Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string progressbar',
];
/** `mac-clicks`, `--mac-clicks`, optionally followed by `off`: 'on' | 'off', or null when the words are something else. */
function parseMacClicks(rest) {
    var m = /^(--)?mac-clicks(?:\s+(on|off))?$/.exec(rest.trim().toLowerCase());
    return m ? (m[2] === 'off' ? 'off' : 'on') : null;
}
function isDarwin($) {
    return __awaiter(this, void 0, void 0, function () {
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, $.process.run(['uname'])];
                case 1: return [2 /*return*/, (_b.sent()).stdout.trim() === 'Darwin'];
                case 2:
                    _a = _b.sent();
                    return [2 /*return*/, false];
                case 3: return [2 /*return*/];
            }
        });
    });
}
exports.NOT_MAC = 'Click to fold needs macOS (it registers a progressbar:// URL handler app). On other systems use `/progress-bar fold <section>`.';
function macClicks($, h, mode) {
    return __awaiter(this, void 0, void 0, function () {
        var app, script, flag, run, fail, r, plist, _i, PLIST_COMMANDS_1, c;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, isDarwin($)];
                case 1:
                    if (!(_a.sent()))
                        return [2 /*return*/, exports.NOT_MAC];
                    app = "".concat(h, "/").concat(exports.APP_REL);
                    script = "".concat(h, "/").concat(exports.SCRIPT_REL);
                    flag = "".concat(h, "/").concat(exports.CLICKS_REL);
                    run = function (argv) { return __awaiter(_this, void 0, void 0, function () {
                        var err_1;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0:
                                    _a.trys.push([0, 2, , 3]);
                                    return [4 /*yield*/, $.process.run(argv)];
                                case 1: return [2 /*return*/, _a.sent()];
                                case 2:
                                    err_1 = _a.sent();
                                    return [2 /*return*/, { exitCode: 1, stdout: '', stderr: String(err_1) }];
                                case 3: return [2 /*return*/];
                            }
                        });
                    }); };
                    fail = function (what, r) { return "Click to fold: ".concat(what, " failed (exit ").concat(r.exitCode, "). ").concat(r.stderr.trim()).trim(); };
                    if (!(mode === 'off')) return [3 /*break*/, 4];
                    return [4 /*yield*/, run([exports.LSREGISTER, '-u', app])];
                case 2:
                    _a.sent();
                    return [4 /*yield*/, run(['rm', '-rf', app, script, flag])];
                case 3:
                    _a.sent();
                    return [2 /*return*/, "Click to fold is off. Removed ".concat(app, " and the header links.")];
                case 4: return [4 /*yield*/, $.fs.write(script, exports.TOGGLE_APPLESCRIPT)];
                case 5:
                    _a.sent();
                    return [4 /*yield*/, run(['rm', '-rf', app])];
                case 6:
                    _a.sent();
                    return [4 /*yield*/, run(['osacompile', '-o', app, script])];
                case 7:
                    r = _a.sent();
                    if (r.exitCode !== 0)
                        return [2 /*return*/, fail('osacompile', r)];
                    plist = "".concat(app, "/Contents/Info.plist");
                    _i = 0, PLIST_COMMANDS_1 = exports.PLIST_COMMANDS;
                    _a.label = 8;
                case 8:
                    if (!(_i < PLIST_COMMANDS_1.length)) return [3 /*break*/, 13];
                    c = PLIST_COMMANDS_1[_i];
                    return [4 /*yield*/, run([PLISTBUDDY, '-c', c, plist])];
                case 9:
                    r = _a.sent();
                    if (!(r.exitCode !== 0 && c.startsWith('Set '))) return [3 /*break*/, 11];
                    return [4 /*yield*/, run([PLISTBUDDY, '-c', c.replace(/^Set (\S+) /, 'Add $1 string '), plist])];
                case 10:
                    r = _a.sent();
                    _a.label = 11;
                case 11:
                    if (r.exitCode !== 0)
                        return [2 /*return*/, fail("PlistBuddy \"".concat(c, "\""), r)];
                    _a.label = 12;
                case 12:
                    _i++;
                    return [3 /*break*/, 8];
                case 13: return [4 /*yield*/, run(['codesign', '--force', '--deep', '-s', '-', app])];
                case 14:
                    r = _a.sent();
                    if (r.exitCode !== 0)
                        return [2 /*return*/, fail('codesign', r)];
                    return [4 /*yield*/, run([exports.LSREGISTER, '-f', app])];
                case 15:
                    r = _a.sent();
                    if (r.exitCode !== 0)
                        return [2 /*return*/, fail('lsregister', r)];
                    return [4 /*yield*/, $.fs.write(flag, '')];
                case 16:
                    _a.sent();
                    return [2 /*return*/, [
                            "Click to fold is on. Built ".concat(app, " and registered progressbar://."),
                            'Section headers in the status line are now links. Click one (⌘-click in Ghostty) to fold or unfold it.',
                            'Needs a terminal that renders OSC 8 links. Inside tmux or herdr you may need FORCE_HYPERLINK=1 or tmux\'s hyperlinks feature.',
                            'Undo with `/progress-bar setup mac-clicks off`.',
                        ].join('\n')];
            }
        });
    });
}
var templateObject_1;
