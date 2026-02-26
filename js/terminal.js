const COLS = 80; // Standard retro width
const ROWS = 25; // Standard retro height
let screenBuffer = [];
let cursorX = 0;
let cursorY = 0;

let pagerLines = [];
let pagerActive = false;

function initTerminal() {
    clearScreen();
    document.addEventListener('keydown', handleKeydown);

    println("GAME III SYSTEM v0.1");
    println("READY.");
    printPrompt();
    renderScreen();
}

function clearScreen() {
    screenBuffer = [];
    for (let i = 0; i < ROWS; i++) {
        screenBuffer.push(new Array(COLS).fill(' '));
    }
    cursorX = 0;
    cursorY = 0;
}

function printPrompt() {
    // End line and add prompt if we aren't already at start
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
            // Escape HTML control characters
            if (ch === '<') ch = '&lt;';
            else if (ch === '>') ch = '&gt;';
            else if (ch === '&') ch = '&amp;';

            // Render cursor
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

// Print string and move to next line
function println(text) {
    printStr(text);
    cursorX = 0;
    cursorY++;
    if (cursorY >= ROWS) {
        scrollUp();
        cursorY = ROWS - 1;
    }
}

// Put a single character into screen buffer at cursor
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

// Shift screen upward to make space at the bottom
function scrollUp() {
    screenBuffer.shift();
    screenBuffer.push(new Array(COLS).fill(' '));
}

// Read current line up to last non-space char
function getLine(y) {
    return screenBuffer[y].join('').trimEnd();
}

// Fullscreen Editor Key Handling
function handleKeydown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;

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
            // Shift characters left
            for (let i = cursorX; i < COLS - 1; i++) {
                screenBuffer[cursorY][i] = screenBuffer[cursorY][i + 1];
            }
            screenBuffer[cursorY][COLS - 1] = ' ';
        }
    } else if (e.key === "Delete") {
        if (cursorX >= minXCurrent) {
            // Shift characters left without moving cursor
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

        // Alphanumeric and symbol input
        // Check if we are inserting (shift chars right) or overtyping
        // Classic BASICs usually overtype, but user asked for "insert"
        // so we'll push everything right.
        for (let i = COLS - 1; i > cursorX; i--) {
            screenBuffer[cursorY][i] = screenBuffer[cursorY][i - 1];
        }

        screenBuffer[cursorY][cursorX] = e.key.toUpperCase();
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

    // Refresh DOM once per key pressed
    renderScreen();
}

// Kickoff
window.addEventListener('load', initTerminal);
