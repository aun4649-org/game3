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

// ---------- Command Processor ----------
function processCommand(line) {
    line = line.trim();
    if (line === "") return;

    // Check if line starts with a number (Line number entry)
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
            // Store with leading space preserved (line format: "lineNo code")
            programMemory[lineNo] = code.length > 0 && code[0] === ' '
                ? code.substring(1) : code;
        }
        return;
    }

    // Direct command — split by first space
    const spaceIdx = line.indexOf(' ');
    const cmd = (spaceIdx >= 0 ? line.substring(0, spaceIdx) : line).toUpperCase();
    const arg = spaceIdx >= 0 ? line.substring(spaceIdx + 1).trim() : "";

    switch (cmd) {
        case "LIST": {
            let start = 0, end = Infinity;
            if (arg) {
                let p = arg.split('-');
                let s = p[0] ? parseInt(p[0], 10) : 0;
                let e = p.length > 1 ? (p[1] ? parseInt(p[1], 10) : Infinity) : s;
                if (!isNaN(s)) start = s;
                if (!isNaN(e)) end = e;
            }
            const lines = Object.keys(programMemory).map(Number).sort((a, b) => a - b);
            const output = [];
            for (let num of lines) {
                if (num >= start && num <= end) {
                    output.push(num + " " + programMemory[num]);
                }
            }
            if (output.length === 0) return "NO PROGRAM";
            return output;
        }

        case "DELETE": {
            if (!arg) return "SYNTAX ERROR";
            let start = 0, end = Infinity;
            let p = arg.split('-');
            let s = p[0] ? parseInt(p[0], 10) : 0;
            let e = p.length > 1 ? (p[1] ? parseInt(p[1], 10) : Infinity) : s;
            if (!isNaN(s)) start = s;
            if (!isNaN(e)) end = e;

            const lines = Object.keys(programMemory).map(Number);
            let deleted = false;
            for (let num of lines) {
                if (num >= start && num <= end) {
                    delete programMemory[num];
                    deleted = true;
                }
            }
            return deleted ? "OK" : "LINE NOT FOUND";
        }

        case "NEW":
            for (let key in programMemory) {
                delete programMemory[key];
            }
            clearVariables();
            return "OK";

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
            let size = parseInt(arg, 10);
            if (!isNaN(size) && size > 5 && size < 100) {
                document.getElementById('screen').style.fontSize = size + "px";
                return "OK";
            }
            return "SYNTAX ERROR";
        }

        case "HELP":
            return [
                "COSMOS II COMMANDS:",
                "  LIST [s]-[e]   : SHOW PROGRAM LINES",
                "  DELETE [s]-[e] : DELETE PROGRAM LINES",
                "  NEW            : CLEAR PROGRAM & VARS",
                "  #=<line>       : EXECUTE PROGRAM FROM LINE",
                "  COLOR W|G|A    : TEXT COLOR (WHITE/GREEN/AMBER)",
                "  FONT <size>    : CHANGE FONT SIZE",
                "  CLEAR / CLS    : CLEAR SCREEN",
                "  HELP           : SHOW THIS MESSAGE"
            ];

        default:
            // Direct expression evaluation or statement execution
            if (typeof cosmosExecuteDirect === "function") {
                return cosmosExecuteDirect(line, programMemory, memory);
            }
            return "SYNTAX ERROR";
    }
}
