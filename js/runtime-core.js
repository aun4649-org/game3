// ============================================================
// runtime-core.js — CosmosRuntime class skeleton
// ============================================================
// Defines the class, constructor, error helpers, and the public
// entry-point functions.  All other methods are added via
// Object.assign(CosmosRuntime.prototype, …) in:
//   runtime-memory.js   — memory / variable access
//   runtime-evaluator.js — expression evaluator
//   runtime-executor.js  — statement execution
//   runtime-loop.js      — main run loop + line navigation
// ============================================================

// Set of token types that mark the start of a valid statement.
// Defined here (module scope) so every runtime-*.js file can share it.
const STATEMENT_START_TYPES = new Set([
    TokenType.VARIABLE,
    TokenType.OP_NOT,
    TokenType.BANG,
    TokenType.AT,
    TokenType.SEMICOLON,
    TokenType.QUESTION,
    TokenType.DQUESTION,
    TokenType.QDOLLAR,
    TokenType.QZERO,
    TokenType.DBLAT,
    TokenType.DOLLAR,
    TokenType.DOT,
    TokenType.SLASH,
    TokenType.STRING,
    TokenType.RBRACKET,
]);

// ======================== RUNTIME CONTEXT ====================

class CosmosRuntime {
    constructor(programMemory, memory) {
        this.programMemory = programMemory;
        this.memory        = memory;

        // Execution state
        // systemVarRemainder (%) is stored in memory at $00D0 (see runtime-memory.js).
        this.callStack  = [];
        this.loopStack  = [];
        this.pc         = -1;
        this.stmtIndex  = 0;
        this.running    = false;
        this.MAX_STACK  = 256;

        // Sorted line number array and O(1) index map.
        // Rebuilt at the start of each run().
        this.sortedLines  = [];
        this.lineIndexMap = new Map();

        // Token cache: lineNo → Token[].
        // Populated lazily in the run loop; cleared at the start of each run().
        // Prevents re-tokenising the same line on every loop iteration.
        this.statementsCache = {};

        // Character position of the first token of the statement currently
        // executing.  Set just before executeStatement(); used by runtimeError /
        // interruptError to point the caret at the right column.
        this.currentStmtPos = 0;

        // Evaluation cursor shared by all recursive-descent eval methods.
        this.evalTokens = [];
        this.evalPos    = 0;
    }

    // ---------- Error Helpers ----------

    syntaxError(msg, pos) {
        return { type: 'SYNTAX', message: `** SYNTAX ERROR : ${msg}`, pos: pos || 0 };
    }

    runtimeError(msg) {
        return {
            type:    'RUNTIME',
            message: `** RUNTIME ERROR : ${msg}`,
            line:    this.pc,
            pos:     this.currentStmtPos,
        };
    }

    interruptError() {
        return {
            type:    'INTERRUPT',
            message: `** Program interrupted`,
            line:    this.pc,
            pos:     this.currentStmtPos,
        };
    }

    // Formats an error into an array of display lines.
    // Two blank lines precede the message so it stands out on the terminal.
    // The caret column accounts for the "<lineNo> " prefix printed before the
    // source text.
    formatError(err, lineContent) {
        const lines = ['', ''];
        lines.push(err.message);
        if (lineContent !== undefined) {
            lines.push(lineContent);
            if (err.pos !== undefined && err.pos >= 0) {
                const prefixLen = String(this.pc).length + 1; // "<lineNo> "
                lines.push(' '.repeat(prefixLen + err.pos) + '^');
            }
        }
        return lines;
    }
}

// ======================== ENTRY POINTS =======================

async function cosmosRun(programMemory, memory) {
    if (typeof window !== "undefined") window.cosmosInterruptFlag = false;
    return await new CosmosRuntime(programMemory, memory).run();
}

async function cosmosExecuteDirect(lineStr, programMemory, memory) {
    if (typeof window !== "undefined") window.cosmosInterruptFlag = false;

    // Inject the direct command at line 0 (below any valid program line number).
    programMemory[0] = lineStr;
    const runtime = new CosmosRuntime(programMemory, memory);

    // Override advanceToNextLine so execution stops after the direct line
    // instead of falling through into the stored program — unless the direct
    // line has already jumped into it via GOTO / GOSUB.
    const originalAdvance = runtime.advanceToNextLine.bind(runtime);
    runtime.advanceToNextLine = function () {
        if (this.pc === 0) this.running = false;
        else originalAdvance();
    };

    try {
        // Run WITHOUT clearing memory so variables persist across direct commands.
        return await runtime.run(false);
    } finally {
        delete programMemory[0];
    }
}
