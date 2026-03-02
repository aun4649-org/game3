// ============================================================
// terminal-input.js — Runtime I/O API
// ============================================================
// Provides the output and input functions called by the runtime
// engine during program execution, plus shared runtime state.
// ============================================================

// ---------- Runtime I/O State ----------
let runtimeRunning = false;
window.cosmosInterruptFlag = false;
let inputResolve = null;  // resolve function for pending input Promise
let inputMode    = null;  // 'char' | 'number'
let inputBuffer  = "";    // accumulator for number-mode input

// ---------- Runtime I/O API ----------

// Output a string without a newline.
// NOTE: renderScreen() is NOT called here to avoid flooding the browser with
// rapid DOM updates in tight loops. The run loop calls renderScreen() once per
// line at its yield point (setTimeout). For input prompts, runtimeInputChar /
// runtimeInputNumber still call renderScreen() to update the display immediately.
function runtimePrint(text) {
    printStr(text);
}

// Output a string followed by a newline.
function runtimePrintln(text) {
    println(text);
}

// Request a single character input — returns a Promise resolved with the char code.
function runtimeInputChar() {
    return new Promise((resolve) => {
        inputMode    = 'char';
        inputResolve = resolve;
        renderScreen();
    });
}

// Request a decimal integer input — returns a Promise resolved with the integer.
function runtimeInputNumber() {
    return new Promise((resolve) => {
        inputMode    = 'number';
        inputBuffer  = "";
        printStr("? ");
        inputResolve = resolve;
        renderScreen();
    });
}

// Called by the terminal key handler when runtime execution finishes.
function runtimeFinish() {
    runtimeRunning = false;
    inputResolve   = null;
    inputMode      = null;
    inputBuffer    = "";
}
