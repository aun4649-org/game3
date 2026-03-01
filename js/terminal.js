// ============================================================
// terminal.js — COSMOS II Terminal UI
// ============================================================
// Full-screen retro terminal with CRT effect.
// Provides I/O primitives used by both editor and runtime.
// ============================================================

const COLS = 80;
const ROWS = 25;
let screenBuffer = [];
let cursorX = 0;
let cursorY = 0;

let pagerLines = [];
let pagerActive = false;

// ---------- Runtime I/O State ----------
let runtimeRunning = false;
window.cosmosInterruptFlag = false; // Added for CTRL+C interrupt tracking
let inputResolve = null;       // resolve function for pending input
let inputMode = null;          // 'char' | 'number'
let inputBuffer = "";          // accumulator for number input

// ---------- ASCII Art ----------
const STARTUP_ART = [
    "",
    "  _____  ____   _____  __  __  ____   _____    ___  ___",
    " / ___/ / __ \\ / ___/ /  |/  |/ __ \\ / ___/   |_  ||  _|",
    "| |    | |  | |\\___ \\/ /|_/ /| |  | |\\___ \\     | || |",
    "| |___ | |__| |___/ / /  / / | |__| |___/ /    _| || |_",
    " \\____/ \\____//____/_/  /_/   \\____//____/    |_ _||___|",
    "",
    "Original designed by Denlen Club and H.Ohnishi.",
    "",
    ""
];

// ---------- Init ----------
function initTerminal() {
    clearScreen();
    document.addEventListener('keydown', handleKeydown);

    // Show startup ASCII art
    for (const line of STARTUP_ART) {
        println(line);
    }
    println("COSMOS II SYSTEM v1.0");
    println("READY.");
    printPrompt();
    renderScreen();
}

// ---------- Screen Management ----------
function clearScreen() {
    screenBuffer = [];
    for (let i = 0; i < ROWS; i++) {
        screenBuffer.push(new Array(COLS).fill(' '));
    }
    cursorX = 0;
    cursorY = 0;
}

function printPrompt() {
    if (cursorX > 0) {
        cursorX = 0;
        cursorY++;
        if (cursorY >= ROWS) {
            scrollUp();
            cursorY = ROWS - 1;
        }
    }
    printStr(">");
}

function printPagerNextPage() {
    if (getLine(cursorY).startsWith("-- MORE --")) {
        screenBuffer[cursorY] = new Array(COLS).fill(' ');
        cursorX = 0;
    }

    let linesToPrint = Math.min(pagerLines.length, ROWS - 2);
    for (let i = 0; i < linesToPrint; i++) {
        println(pagerLines.shift());
    }

    if (pagerLines.length > 0) {
        printStr("-- MORE --");
    } else {
        pagerActive = false;
        printPrompt();
    }
}

function renderScreen() {
    let output = '';
    for (let r = 0; r < ROWS; r++) {
        let line = '';
        for (let c = 0; c < COLS; c++) {
            let ch = screenBuffer[r][c];
            if (ch === '<') ch = '&lt;';
            else if (ch === '>') ch = '&gt;';
            else if (ch === '&') ch = '&amp;';

            if (r === cursorY && c === cursorX) {
                line += `<span class="cursor">${ch}</span>`;
            } else {
                line += ch;
            }
        }
        output += line + '\n';
    }
    document.getElementById('screen').innerHTML = output;
}

function printStr(text) {
    for (let i = 0; i < text.length; i++) {
        putchar(text[i]);
    }
}

function println(text) {
    printStr(text);
    newline();
}

function newline() {
    cursorX = 0;
    cursorY++;
    if (cursorY >= ROWS) {
        scrollUp();
        cursorY = ROWS - 1;
    }
}

function putchar(ch) {
    if (cursorY >= ROWS) {
        scrollUp();
        cursorY = ROWS - 1;
    }
    if (cursorX >= COLS) {
        cursorX = 0;
        cursorY++;
        if (cursorY >= ROWS) {
            scrollUp();
            cursorY = ROWS - 1;
        }
    }
    screenBuffer[cursorY][cursorX] = ch;
    cursorX++;
}

function scrollUp() {
    screenBuffer.shift();
    screenBuffer.push(new Array(COLS).fill(' '));
}

function getLine(y) {
    return screenBuffer[y].join('').trimEnd();
}

// ---------- Runtime I/O API ----------
// These are called by the runtime engine during program execution.

// Output a string (no newline)
// NOTE: renderScreen() is NOT called here to avoid flooding the browser with
// rapid DOM updates in tight loops. The run loop calls renderScreen() once per
// line at its yield point (setTimeout). For input prompts, runtimeInputChar /
// runtimeInputNumber still call renderScreen() directly.
function runtimePrint(text) {
    printStr(text);
}

// Output a string with newline
function runtimePrintln(text) {
    println(text);
}

// Request a single character input from user — returns a Promise
function runtimeInputChar() {
    return new Promise((resolve) => {
        inputMode = 'char';
        inputResolve = resolve;
        renderScreen();
    });
}

// Request a number input from user — returns a Promise
function runtimeInputNumber() {
    return new Promise((resolve) => {
        inputMode = 'number';
        inputBuffer = "";
        printStr("? ");
        inputResolve = resolve;
        renderScreen();
    });
}

// Finish runtime mode
function runtimeFinish() {
    runtimeRunning = false;
    inputResolve = null;
    inputMode = null;
    inputBuffer = "";
}

// ---------- Key Handler ----------
function handleKeydown(e) {
    if (e.ctrlKey && e.key.toLowerCase() === 'c') {
        window.cosmosInterruptFlag = true;

        if (runtimeRunning) {
            // Always prevent default during runtime so the browser doesn't
            // intercept the key (e.g. clipboard copy) while execution is active.
            e.preventDefault();
            if (inputResolve) {
                // Immediately unblock any pending input wait.
                const resolve = inputResolve;
                inputResolve = null;
                inputMode = null;
                resolve({ interrupted: true });
            }
            return;
        }
    }

    if (e.ctrlKey || e.metaKey || e.altKey) return;

    // --- Runtime input mode ---
    if (runtimeRunning && inputResolve) {
        e.preventDefault();

        if (inputMode === 'char') {
            if (e.key.length === 1) {
                const code = e.key.charCodeAt(0);
                putchar(e.key);
                renderScreen();
                const resolve = inputResolve;
                inputResolve = null;
                inputMode = null;
                resolve(code);
            }
            return;
        }

        if (inputMode === 'number') {
            if (e.key === "Enter") {
                newline();
                const val = parseInt(inputBuffer, 10);
                if (isNaN(val) || val < -2147483648 || val > 2147483647) {
                    // Invalid — re-prompt
                    inputBuffer = "";
                    printStr("? ");
                    renderScreen();
                    return;
                }
                const resolve = inputResolve;
                inputResolve = null;
                inputMode = null;
                resolve(val);
            } else if (e.key === "Backspace") {
                if (inputBuffer.length > 0) {
                    inputBuffer = inputBuffer.slice(0, -1);
                    if (cursorX > 0) {
                        cursorX--;
                        screenBuffer[cursorY][cursorX] = ' ';
                    }
                }
            } else if (e.key.length === 1 && /[0-9\-]/.test(e.key)) {
                inputBuffer += e.key;
                putchar(e.key);
            }
            renderScreen();
            return;
        }

        // Runtime running but no input pending — ignore keys
        return;
    }

    // --- Normal editor mode ---
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "Backspace", "Delete", "Enter"].includes(e.key)) {
        e.preventDefault();
    }

    if (pagerActive) {
        printPagerNextPage();
        renderScreen();
        return;
    }

    let minXCurrent = screenBuffer[cursorY][0] === '>' ? 1 : 0;

    if (e.key === "ArrowLeft") {
        if (cursorX > minXCurrent) cursorX--;
    } else if (e.key === "ArrowRight") {
        if (cursorX < COLS - 1) cursorX++;
    } else if (e.key === "ArrowUp") {
        if (cursorY > 0) {
            cursorY--;
            let minXNew = screenBuffer[cursorY][0] === '>' ? 1 : 0;
            if (cursorX < minXNew) cursorX = minXNew;
        }
    } else if (e.key === "ArrowDown") {
        if (cursorY < ROWS - 1) {
            cursorY++;
            let minXNew = screenBuffer[cursorY][0] === '>' ? 1 : 0;
            if (cursorX < minXNew) cursorX = minXNew;
        }
    } else if (e.key === "Backspace") {
        if (cursorX > minXCurrent) {
            cursorX--;
            for (let i = cursorX; i < COLS - 1; i++) {
                screenBuffer[cursorY][i] = screenBuffer[cursorY][i + 1];
            }
            screenBuffer[cursorY][COLS - 1] = ' ';
        }
    } else if (e.key === "Delete") {
        if (cursorX >= minXCurrent) {
            for (let i = cursorX; i < COLS - 1; i++) {
                screenBuffer[cursorY][i] = screenBuffer[cursorY][i + 1];
            }
            screenBuffer[cursorY][COLS - 1] = ' ';
        }
    } else if (e.key === "Enter") {
        let lineText = getLine(cursorY);
        if (lineText.startsWith(">")) {
            lineText = lineText.substring(1);
        }

        cursorX = 0;
        cursorY++;
        if (cursorY >= ROWS) {
            scrollUp();
            cursorY = ROWS - 1;
        }

        if (typeof processCommand === "function") {
            let out = processCommand(lineText);

            // Handle async (RUN returns a Promise)
            if (out instanceof Promise) {
                runtimeRunning = true;
                out.then((result) => {
                    runtimeFinish();
                    if (result !== undefined && result !== "") {
                        println(String(result));
                    }
                    printPrompt();
                    renderScreen();
                }).catch((err) => {
                    runtimeFinish();
                    println(String(err));
                    printPrompt();
                    renderScreen();
                });
                renderScreen();
                return;
            }

            if (Array.isArray(out)) {
                pagerLines = out;
                if (pagerLines.length > 0) {
                    pagerActive = true;
                    printPagerNextPage();
                } else {
                    printPrompt();
                }
            } else {
                if (out !== undefined && out !== "") {
                    println(String(out));
                }
                printPrompt();
            }
        } else {
            printPrompt();
        }
    } else if (e.key.length === 1) {
        if (cursorX < minXCurrent) cursorX = minXCurrent;

        // Insert mode — shift characters right
        for (let i = COLS - 1; i > cursorX; i--) {
            screenBuffer[cursorY][i] = screenBuffer[cursorY][i - 1];
        }

        // Store the character AS-IS (lowercase support!)
        screenBuffer[cursorY][cursorX] = e.key;
        cursorX++;
        if (cursorX >= COLS) {
            cursorX = 0;
            cursorY++;
            if (cursorY >= ROWS) {
                scrollUp();
                cursorY = ROWS - 1;
            }
            let minXNew = screenBuffer[cursorY][0] === '>' ? 1 : 0;
            if (cursorX < minXNew) cursorX = minXNew;
        }
    }

    renderScreen();
}

// ---------- Kickoff ----------
window.addEventListener('load', initTerminal);
