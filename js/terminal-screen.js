// ============================================================
// terminal-screen.js — Screen buffer and rendering
// ============================================================
// Manages the 80×25 character screen buffer, cursor, scrolling,
// pager, and DOM rendering for the COSMOS II terminal.
// ============================================================

const COLS = 80;
const ROWS = 25;
let screenBuffer = [];
let cursorX = 0;
let cursorY = 0;

let pagerLines  = [];
let pagerActive = false;

// ---------- ASCII Art ----------
const STARTUP_ART = [
    "",
    "       .                     .              .",
    "    .               .             .       .",
    "   ____ ___  ____  __  __  ___  ____    __  __  _",
    "  / ___/ _ \/ ___||  \/  |/ _ \/ ___|. |_ || _|( )",
    " | |  | | | \___ \| |\/| | | | \___ \    ||||  )/",
    " | |__| |_| |___) | |  | | |_| |___) |. _||||_",
    "  \____\___/|____/|_|  |_|\___/|____/. |__||__|",
    "          .                  .             .",
    "    .          .                   .",
    "",
    ""
];

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

    const linesToPrint = Math.min(pagerLines.length, ROWS - 2);
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
            if      (ch === '<') ch = '&lt;';
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
