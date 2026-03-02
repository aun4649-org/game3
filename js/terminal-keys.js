// ============================================================
// terminal-keys.js — Keyboard handler and terminal init
// ============================================================
// Handles all keyboard input for both editor mode and runtime
// input mode.  Also contains the startup sequence.
// ============================================================

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
                inputMode    = null;
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
                inputMode    = null;
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
                inputMode    = null;
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

    const minXCurrent = screenBuffer[cursorY][0] === '>' ? 1 : 0;

    if (e.key === "ArrowLeft") {
        if (cursorX > minXCurrent) cursorX--;
    } else if (e.key === "ArrowRight") {
        if (cursorX < COLS - 1) cursorX++;
    } else if (e.key === "ArrowUp") {
        if (cursorY > 0) {
            cursorY--;
            const minXNew = screenBuffer[cursorY][0] === '>' ? 1 : 0;
            if (cursorX < minXNew) cursorX = minXNew;
        }
    } else if (e.key === "ArrowDown") {
        if (cursorY < ROWS - 1) {
            cursorY++;
            const minXNew = screenBuffer[cursorY][0] === '>' ? 1 : 0;
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
            const out = processCommand(lineText);

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
        screenBuffer[cursorY][cursorX] = e.key;
        cursorX++;
        if (cursorX >= COLS) {
            cursorX = 0;
            cursorY++;
            if (cursorY >= ROWS) {
                scrollUp();
                cursorY = ROWS - 1;
            }
            const minXNew = screenBuffer[cursorY][0] === '>' ? 1 : 0;
            if (cursorX < minXNew) cursorX = minXNew;
        }
    }

    renderScreen();
}

// ---------- Terminal Init ----------

function initTerminal() {
    clearScreen();
    document.addEventListener('keydown', handleKeydown);

    for (const line of STARTUP_ART) {
        println(line);
    }
    println("COSMOS II SYSTEM v1.0");
    println("Original designed by Denken Club and H.Ohnishi.");
    println("");
    println("READY.");
    printPrompt();
    renderScreen();
}

window.addEventListener('load', initTerminal);
