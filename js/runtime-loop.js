// ============================================================
// runtime-loop.js — Main execution loop and line navigation
// ============================================================
// Adds findLine, advanceToNextLine, and run to
// CosmosRuntime.prototype.
// ============================================================

Object.assign(CosmosRuntime.prototype, {

    // ---------- GOTO/GOSUB Line Resolution ------------------
    // Binary search: finds the smallest existing line number >= targetLineNo.
    // Returns -1 for END, null if no such line exists.
    findLine(targetLineNo) {
        targetLineNo = toInt32(targetLineNo);
        if (targetLineNo === -1) return -1;

        const lines = this.sortedLines;
        let lo = 0, hi = lines.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (lines[mid] < targetLineNo) lo = mid + 1;
            else hi = mid;
        }
        // Skip non-positive entries (line 0 is the direct-mode injected line)
        while (lo < lines.length && lines[lo] <= 0) lo++;
        return lo < lines.length ? lines[lo] : null;
    },

    // ---------- Line Navigation -----------------------------

    advanceToNextLine() {
        const idx = this.lineIndexMap.get(this.pc);
        if (idx === undefined || idx + 1 >= this.sortedLines.length) {
            this.running = false;
            return;
        }
        this.pc        = this.sortedLines[idx + 1];
        this.stmtIndex = 0;
    },

    // ---------- Main Execution Loop -------------------------

    async run(clearMem = true) {
        this.statementsCache = {}; // clear token cache for new run
        this.callStack       = [];
        this.loopStack       = [];
        // Variables and system variables are NOT cleared on program run.
        // They retain their values from the previous execution.
        // Use @@ to explicitly reset variables.

        this.sortedLines = Object.keys(this.programMemory).map(Number).sort((a, b) => a - b);
        if (this.sortedLines.length === 0) return "NO PROGRAM";

        // Build O(1) index map: lineNo → index in sortedLines
        this.lineIndexMap = new Map();
        for (let i = 0; i < this.sortedLines.length; i++) {
            this.lineIndexMap.set(this.sortedLines[i], i);
        }

        this.pc        = this.sortedLines[0];
        this.stmtIndex = 0;
        this.running   = true;

        try {
            while (this.running) {
                const lineNo = this.pc;
                this.currentStmtPos = 0; // reset per-line before any statement runs

                // Past-the-end check: lineNo not in map and larger than last line
                if (!this.lineIndexMap.has(lineNo) &&
                    lineNo > this.sortedLines[this.sortedLines.length - 1]) {
                    break;
                }

                // Top-of-line interrupt check
                if (window.cosmosInterruptFlag) throw this.interruptError();

                const source = this.programMemory[lineNo];
                if (source === undefined) break;

                // Retrieve (or populate) the token cache for this line.
                // In loops the same line is visited many times; caching avoids
                // repeated tokenisation which would dominate tight-loop performance.
                let allTokens = this.statementsCache[lineNo];
                if (allTokens === undefined) {
                    allTokens = new Tokenizer(source).tokenize();
                    this.statementsCache[lineNo] = allTokens;
                }

                // Yield to the browser event loop once per line.
                // Allows key events (CTRL+C) to be processed and the screen
                // to be repainted without flooding the DOM with per-print updates.
                await new Promise(r => setTimeout(r, 0));
                if (typeof renderScreen === "function") renderScreen();

                this.initEval(allTokens, 0);

                // Skip leading statement separators (spaces before the first statement).
                while (this.evalPeek().type === TokenType.STMTSEP) this.evalAdvance();

                // Skip empty / comment lines
                if (this.isComment(this.evalPeek())) {
                    this.advanceToNextLine();
                    continue;
                }

                let currentStmt  = 0;
                const skipToStmt = this.stmtIndex;
                let jumped       = false;

                while (this.evalPeek().type !== TokenType.EOF) {
                    // Skip statement separators between statements.
                    while (this.evalPeek().type === TokenType.STMTSEP) this.evalAdvance();
                    if (this.evalPeek().type === TokenType.EOF) break;

                    const startPos = this.evalPos;

                    if (currentStmt < skipToStmt) {
                        this.skipOneStatement();
                        currentStmt++;
                        continue;
                    }

                    // stmtIndex is updated to the *next* statement before executing
                    // the current one, so GOSUB saves the correct return address.
                    this.stmtIndex = currentStmt + 1;

                    // Capture first-token position for error reporting
                    const peek = this.evalPeek();
                    this.currentStmtPos = peek.pos >= 0 ? peek.pos : 0;

                    const result = await this.executeStatement();

                    // Post-statement interrupt check (catches CTRL+C during async I/O)
                    if (window.cosmosInterruptFlag) throw this.interruptError();

                    switch (result) {
                        case 'NEXT':      currentStmt++; break;
                        case 'SKIP_LINE': jumped = true; this.advanceToNextLine(); break;
                        case 'JUMPED':    jumped = true; break;
                        case 'RETURNED':  jumped = true; break;
                        case 'END':       this.running = false; jumped = true; break;
                    }
                    if (jumped) break;

                    // Safety: if no tokens were consumed and not at EOF, break
                    // to prevent an infinite loop on an unexpected statement form.
                    if (this.evalPos === startPos) break;
                }

                if (!jumped) this.advanceToNextLine();
            }
        } catch (err) {
            if (err && (err.type === 'RUNTIME' || err.type === 'INTERRUPT' || err.type === 'SYNTAX')) {
                const source = this.programMemory[this.pc] || "";
                const lines  = this.formatError(err, this.pc + " " + source);
                for (const line of lines) runtimePrintln(line);
                return "";
            }
            throw err;
        }

        return "";
    },

});
