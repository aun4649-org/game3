// ============================================================
// editor.js — COSMOS II Editor / Command Processor
// ============================================================
// Manages program memory and direct-mode commands.
// The 64KB virtual memory and variable system live here.
// ============================================================

// ---------- 64KB Virtual Memory ----------
const memory = new Uint8Array(65536);

// ---------- Program Memory (line-number → source string) ----------
const programMemory = {};

// ---------- Variable Address Helpers ----------
// A-Z: $0000..$0064 (each 4 bytes), a-z: $0068..$00CC
function varAddress(name) {
    const ch = name.charCodeAt(0);
    if (ch >= 65 && ch <= 90) {          // A-Z
        return (ch - 65) * 4;            // $0000, $0004, ..., $0064
    } else if (ch >= 97 && ch <= 122) {  // a-z
        return 0x0068 + (ch - 97) * 4;   // $0068, $006C, ..., $00CC
    }
    return -1; // invalid
}

// Read 32-bit signed integer from memory (big-endian)
function memReadDword(addr) {
    const u = (memory[addr] << 24) | (memory[addr + 1] << 16) |
              (memory[addr + 2] << 8) | memory[addr + 3];
    return u | 0; // convert to signed int32
}

// Write 32-bit signed integer to memory (big-endian)
function memWriteDword(addr, value) {
    const v = value | 0;
    memory[addr]     = (v >>> 24) & 0xFF;
    memory[addr + 1] = (v >>> 16) & 0xFF;
    memory[addr + 2] = (v >>> 8) & 0xFF;
    memory[addr + 3] = v & 0xFF;
}

// Read 16-bit signed integer from memory (big-endian)
function memReadWord(addr) {
    const u = (memory[addr] << 8) | memory[addr + 1];
    return (u << 16) >> 16; // sign-extend to 32-bit
}

// Write 16-bit to memory (big-endian)
function memWriteWord(addr, value) {
    const v = value & 0xFFFF;
    memory[addr]     = (v >> 8) & 0xFF;
    memory[addr + 1] = v & 0xFF;
}

// Get variable value (32-bit signed)
function getVar(name) {
    const addr = varAddress(name);
    if (addr < 0) return 0;
    return memReadDword(addr);
}

// Set variable value (32-bit signed)
function setVar(name, value) {
    const addr = varAddress(name);
    if (addr < 0) return;
    memWriteDword(addr, value);
}

// Clear all variables (zero variable area)
function clearVariables() {
    memory.fill(0, 0x0000, 0x00D0);
}

// ---------- Color Theme ----------
function applyColorTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
}

// ---------- Range Helpers ----------

// Parses a range argument like "10-50", "100-", "-20", "10".
// Returns { start: number|null, end: number|null }, or null on error.
// null means "not specified" (open boundary).
// Returns null if start > end (invalid range).
function parseRange(arg) {
    if (!arg) return { start: null, end: null };

    const dashIdx = arg.indexOf('-');
    if (dashIdx === -1) {
        const n = parseInt(arg, 10);
        if (isNaN(n)) return null;
        return { start: n, end: n };
    }

    const startStr = arg.substring(0, dashIdx).trim();
    const endStr   = arg.substring(dashIdx + 1).trim();
    const start = startStr ? parseInt(startStr, 10) : null;
    const end   = endStr   ? parseInt(endStr,   10) : null;
    if (startStr && isNaN(start)) return null;
    if (endStr   && isNaN(end))   return null;
    if (start !== null && end !== null && start > end) return null;
    return { start, end };
}

// Applies 行番号解決: resolves start/end specs to existing line numbers.
//   startSpec: number (smallest existing line >= startSpec) or null (from beginning)
//   endSpec:   number (largest existing line <= endSpec)   or null (to end)
// Returns sorted array of line numbers in the resolved range.
function resolveRange(allLines, startSpec, endSpec) {
    if (allLines.length === 0) return [];

    let lo, hi;

    if (startSpec === null) {
        lo = allLines[0];
    } else {
        const found = allLines.find(n => n >= startSpec);
        if (found === undefined) return [];
        lo = found;
    }

    if (endSpec === null) {
        hi = allLines[allLines.length - 1];
    } else {
        const candidates = allLines.filter(n => n <= endSpec);
        if (candidates.length === 0) return [];
        hi = candidates[candidates.length - 1];
    }

    return allLines.filter(n => n >= lo && n <= hi);
}

// ---------- Confirmation Prompt ----------

// Prints "[promptText]. ARE YOU SURE? (Y/N)", waits for a single key.
// Resolves to true if 'Y'/'y' was pressed, false otherwise.
// Relies on runtimeInputChar() from terminal.js.
function waitForConfirm(promptText) {
    println(promptText + ". ARE YOU SURE? (Y/N)");
    renderScreen();
    return runtimeInputChar().then(code => {
        newline();
        renderScreen();
        if (code && typeof code === 'object' && code.interrupted) return false;
        return String.fromCharCode(code).toUpperCase() === 'Y';
    });
}

// ---------- Command Processor ----------
function processCommand(line) {
    line = line.trim();
    if (line === "") return;

    // --- LIST shorthand (no LIST keyword): [start]-[end] or [start]- ---
    // Must match digits immediately followed by '-', with optional trailing digits.
    // '-[end]' form is NOT valid as a shorthand (per spec [LIST短縮形]).
    const listShorthand = line.match(/^(\d+)-(\d*)$/);
    if (listShorthand) {
        const startSpec = parseInt(listShorthand[1], 10);
        const endSpec   = listShorthand[2] ? parseInt(listShorthand[2], 10) : null;
        if (endSpec !== null && startSpec > endSpec) return "SYNTAX ERROR";

        const allLines = Object.keys(programMemory).map(Number).sort((a, b) => a - b);
        if (allLines.length === 0) return "NO PROGRAM";
        const result = resolveRange(allLines, startSpec, endSpec);
        if (result.length === 0) return "NO PROGRAM";
        return result.map(num => num + " " + programMemory[num]);
    }

    // --- Line number entry: [lineNo][code] ---
    const lineNumMatch = line.match(/^(\d+)(.*)$/);
    if (lineNumMatch) {
        const lineNo = parseInt(lineNumMatch[1], 10);
        const code = lineNumMatch[2];

        if (lineNo < 1 || lineNo > 32767) {
            return "LINE NUMBER OUT OF RANGE (1-32767)";
        }

        if (code.trim() === "") {
            delete programMemory[lineNo];
        } else {
            // Store with leading space preserved (spec §2.1)
            programMemory[lineNo] = code.length > 0 && code[0] === ' '
                ? code.substring(1) : code;
        }
        return;
    }

    // --- System commands ---
    const spaceIdx = line.indexOf(' ');
    const cmd = (spaceIdx >= 0 ? line.substring(0, spaceIdx) : line).toUpperCase();
    const arg = spaceIdx >= 0 ? line.substring(spaceIdx + 1).trim() : "";

    switch (cmd) {
        case "LIST": {
            const range = parseRange(arg);
            if (range === null) return "SYNTAX ERROR";

            const allLines = Object.keys(programMemory).map(Number).sort((a, b) => a - b);
            if (allLines.length === 0) return "NO PROGRAM";
            const result = resolveRange(allLines, range.start, range.end);
            if (result.length === 0) return "NO PROGRAM";
            return result.map(num => num + " " + programMemory[num]);
        }

        case "DELETE":
        case "DEL": {
            if (!arg || !arg.includes('-')) return "SYNTAX ERROR";
            const range = parseRange(arg);
            if (range === null || range.start === null) return "SYNTAX ERROR";

            const allLines = Object.keys(programMemory).map(Number).sort((a, b) => a - b);
            const toDelete = resolveRange(allLines, range.start, range.end);
            if (toDelete.length === 0) return "LINE NOT FOUND";

            return waitForConfirm(cmd + " " + arg).then(confirmed => {
                if (!confirmed) return "CANCELLED";
                for (const num of toDelete) delete programMemory[num];
                return "OK";
            });
        }

        case "NEW":
            return waitForConfirm("NEW").then(confirmed => {
                if (!confirmed) return "CANCELLED";
                for (let key in programMemory) delete programMemory[key];
                clearVariables();
                return "OK";
            });

        case "CLEAR":
        case "CLS":
            clearScreen();
            return;

        case "COLOR": {
            const theme = arg.toUpperCase();
            if (theme === "WHITE" || theme === "W") {
                applyColorTheme("white");
                return "OK";
            } else if (theme === "GREEN" || theme === "G") {
                applyColorTheme("green");
                return "OK";
            } else if (theme === "AMBER" || theme === "A" || theme === "") {
                applyColorTheme("amber");
                return "OK";
            }
            return "USAGE: COLOR WHITE|GREEN|AMBER";
        }

        case "FONT": {
            const size = parseInt(arg, 10);
            if (!isNaN(size) && size >= 9 && size <= 72) {
                document.getElementById('screen').style.fontSize = size + "px";
                return "OK";
            }
            return "SYNTAX ERROR";
        }

        case "HELP":
            return [
                "COSMOS II COMMANDS:",
                "  LIST [s]-[e]       : SHOW PROGRAM LINES",
                "  [s]-[e] or [s]-   : SHOW LINES (SHORTHAND, NO LIST KEYWORD)",
                "  DELETE/DEL [s]-[e] : DELETE PROGRAM LINES",
                "  NEW                : CLEAR PROGRAM & VARS",
                "  #=<line>           : EXECUTE PROGRAM FROM LINE",
                "  COLOR W|G|A        : TEXT COLOR (WHITE/GREEN/AMBER)",
                "  FONT <size>        : CHANGE FONT SIZE (9-72)",
                "  CLEAR / CLS        : CLEAR SCREEN",
                "  HELP               : SHOW THIS MESSAGE"
            ];

        default:
            // Direct expression/statement execution
            if (typeof cosmosExecuteDirect === "function") {
                return cosmosExecuteDirect(line, programMemory, memory);
            }
            return "SYNTAX ERROR";
    }
}
