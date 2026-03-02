// ============================================================
// runtime-executor.js — Statement execution
// ============================================================
// Adds executeStatement, skipOneStatement, isComment, and
// isStatementStart to CosmosRuntime.prototype.
// ============================================================

Object.assign(CosmosRuntime.prototype, {

    // ---------- Statement Execution -------------------------

    async executeStatement() {
        const t = this.evalPeek();

        // ---- String Output: "..." ----
        if (t.type === TokenType.STRING) {
            this.evalAdvance();
            runtimePrint(t.value);
            return 'NEXT';
        }

        // ---- Newline Output: / ----
        if (t.type === TokenType.SLASH) {
            this.evalAdvance();
            runtimePrintln("");
            return 'NEXT';
        }

        // ---- RETURN: ] ----
        if (t.type === TokenType.RBRACKET) {
            this.evalAdvance();
            if (this.callStack.length === 0) throw this.runtimeError("Stack underflow");
            const ret = this.callStack.pop();
            this.pc        = ret.pc;
            this.stmtIndex = ret.stmtIndex;
            return 'RETURNED';
        }

        // ---- GOTO: #=<expr> ----
        if (t.type === TokenType.OP_NOT) {
            this.evalAdvance();
            if (this.evalPeek().type !== TokenType.ASSIGN)
                throw this.syntaxError("Undefined syntax", t.pos);
            this.evalAdvance();
            const target = this.findLine(await this.evalExpression());
            if (target === -1) return 'END';
            if (target === null) throw this.runtimeError("Undefined line number");
            this.pc = target; this.stmtIndex = 0;
            return 'JUMPED';
        }

        // ---- GOSUB: !=<expr> ----
        if (t.type === TokenType.BANG) {
            this.evalAdvance();
            this.evalExpect(TokenType.ASSIGN);
            const target = this.findLine(await this.evalExpression());
            if (target === -1) return 'END';
            if (target === null) throw this.runtimeError("Undefined line number");
            if (this.callStack.length >= this.MAX_STACK) throw this.runtimeError("Stack overflow");
            this.callStack.push({ pc: this.pc, stmtIndex: this.stmtIndex });
            this.pc = target; this.stmtIndex = 0;
            return 'JUMPED';
        }

        // ---- IF: ;=<expr> ----
        if (t.type === TokenType.SEMICOLON) {
            this.evalAdvance();
            this.evalExpect(TokenType.ASSIGN);
            return (await this.evalExpression()) === 0 ? 'SKIP_LINE' : 'NEXT';
        }

        // ---- DO / UNTIL / FOR-NEXT: @ ----
        if (t.type === TokenType.AT) {
            this.evalAdvance();
            const next = this.evalPeek();

            if (next.type === TokenType.ASSIGN) {
                this.evalAdvance(); // skip =
                const next2 = this.evalPeek();

                if (next2.type === TokenType.LPAREN) {
                    // @=(expr) — UNTIL
                    this.evalAdvance(); // skip (
                    const cond = await this.evalExpression();
                    this.evalExpect(TokenType.RPAREN);
                    if (this.loopStack.length === 0) throw this.runtimeError("Mismatched control blocks");
                    if (cond === 0) {
                        // Loop back to DO
                        const top = this.loopStack[this.loopStack.length - 1];
                        this.pc = top.pc; this.stmtIndex = top.stmtIndex;
                        return 'JUMPED';
                    }
                    this.loopStack.pop();
                    return 'NEXT';
                }

                // @=<expr> — FOR-NEXT upper bound
                const upperBound = await this.evalExpression();
                if (this.loopStack.length === 0) throw this.runtimeError("Mismatched control blocks");
                const loop = this.loopStack[this.loopStack.length - 1];
                if (!loop.forVar) throw this.runtimeError("Mismatched control blocks");

                const newVal = toInt32(this.getVar(loop.forVar) + loop.step);
                this.setVar(loop.forVar, newVal);
                const done = loop.step > 0 ? newVal > upperBound : newVal < upperBound;
                if (done) {
                    this.loopStack.pop();
                    return 'NEXT';
                }
                this.pc = loop.pc; this.stmtIndex = loop.stmtIndex;
                return 'JUMPED';
            }

            // Plain @ — DO (loop start marker)
            this.loopStack.push({ pc: this.pc, stmtIndex: this.stmtIndex });
            return 'NEXT';
        }

        // ---- @@ — clear user variables and system variable % ----
        if (t.type === TokenType.DBLAT) {
            this.evalAdvance();
            this.memory.fill(0, 0x0000, 0x00D4);
            return 'NEXT';
        }

        // ---- Output statements ----

        // ?? = expr — hex 4-digit
        if (t.type === TokenType.DQUESTION) {
            this.evalAdvance();
            this.evalExpect(TokenType.ASSIGN);
            const val = await this.evalExpression();
            runtimePrint((val & 0xFFFF).toString(16).toUpperCase().padStart(4, '0'));
            return 'NEXT';
        }

        // ?$ = expr — hex 2-digit  /  ?$(n) = expr — hex n-digit
        if (t.type === TokenType.QDOLLAR) {
            this.evalAdvance();
            const next = this.evalPeek();

            if (next.type === TokenType.LPAREN) {
                // ?$(n) = expr — hex n-digit (zero-padded, rightmost n digits)
                this.evalAdvance();
                const widthTok = this.evalPeek();
                if (widthTok.type !== TokenType.NUMBER) throw this.syntaxError("Undefined syntax", widthTok.pos);
                const n = widthTok.value;
                this.evalAdvance();
                this.evalExpect(TokenType.RPAREN);
                this.evalExpect(TokenType.ASSIGN);
                const val = await this.evalExpression();
                const hex = toUint32(val).toString(16).toUpperCase().padStart(n, '0');
                runtimePrint(n > 0 ? hex.slice(-n) : '');
                return 'NEXT';
            }
            if (next.type === TokenType.ASSIGN) {
                // ?$ = expr — hex 2-digit
                this.evalAdvance();
                const val = await this.evalExpression();
                runtimePrint((val & 0xFF).toString(16).toUpperCase().padStart(2, '0'));
                return 'NEXT';
            }
            throw this.syntaxError("Undefined syntax", t.pos);
        }

        // ?0(n) = expr — zero-padded decimal
        if (t.type === TokenType.QZERO) {
            this.evalAdvance();
            this.evalExpect(TokenType.LPAREN);
            const widthTok = this.evalPeek();
            if (widthTok.type !== TokenType.NUMBER) throw this.syntaxError("Undefined syntax", widthTok.pos);
            const width = widthTok.value;
            this.evalAdvance();
            this.evalExpect(TokenType.RPAREN);
            this.evalExpect(TokenType.ASSIGN);
            const val    = await this.evalExpression();
            const neg    = val < 0;
            const absStr = Math.abs(val).toString();
            const padLen = neg ? width - 1 : width;
            runtimePrint(neg ? '-' + absStr.padStart(padLen, '0') : absStr.padStart(padLen, '0'));
            return 'NEXT';
        }

        // ?(n) = expr | ?= expr
        if (t.type === TokenType.QUESTION) {
            this.evalAdvance();
            const next = this.evalPeek();

            if (next.type === TokenType.LPAREN) {
                // ?(n) = expr — space-padded decimal
                this.evalAdvance();
                const widthTok = this.evalPeek();
                if (widthTok.type !== TokenType.NUMBER) throw this.syntaxError("Undefined syntax", widthTok.pos);
                const width = widthTok.value;
                this.evalAdvance();
                this.evalExpect(TokenType.RPAREN);
                this.evalExpect(TokenType.ASSIGN);
                runtimePrint((await this.evalExpression()).toString().padStart(width, ' '));
                return 'NEXT';
            }
            if (next.type === TokenType.ASSIGN) {
                // ?= expr — decimal output
                this.evalAdvance();
                runtimePrint((await this.evalExpression()).toString());
                return 'NEXT';
            }
            throw this.syntaxError("Undefined syntax", t.pos);
        }

        // $= expr — character output
        if (t.type === TokenType.DOLLAR) {
            this.evalAdvance();
            this.evalExpect(TokenType.ASSIGN);
            runtimePrint(String.fromCharCode((await this.evalExpression()) & 0x7F));
            return 'NEXT';
        }

        // .= expr — space output
        if (t.type === TokenType.DOT) {
            this.evalAdvance();
            this.evalExpect(TokenType.ASSIGN);
            const n = await this.evalExpression();
            if (n > 0) runtimePrint(' '.repeat(n));
            return 'NEXT';
        }

        // ---- Assignment / FOR statement: var = expr [, step] ----
        if (t.type === TokenType.VARIABLE) {
            const target = await this.evalAssignTarget();
            this.evalExpect(TokenType.ASSIGN);
            this.assignToTarget(target, await this.evalExpression());

            if (this.evalPeek().type === TokenType.COMMA) {
                this.evalAdvance();
                const step = toInt32(await this.evalExpression());
                this.loopStack.push({
                    pc:        this.pc,
                    stmtIndex: this.stmtIndex,
                    forVar:    target.name,
                    step,
                });
            }
            return 'NEXT';
        }

        throw this.syntaxError("Undefined syntax", t.pos);
    },

    // ---------- Statement-type Helpers ----------------------

    // Returns true when the token cannot start a statement (treated as a comment).
    isComment(token) {
        return !STATEMENT_START_TYPES.has(token.type);
    },

    isStatementStart(token) {
        return STATEMENT_START_TYPES.has(token.type);
    },

    // Fast-forward past one statement without executing.
    // Used to reach the saved stmtIndex after a mid-line jump.
    // Statements are delimited by STMTSEP (space) tokens; this method
    // consumes exactly one statement's tokens, stopping before the
    // STMTSEP (or EOF) that follows it.
    skipOneStatement() {
        const t = this.evalPeek();

        // One-token statements
        if (t.type === TokenType.STRING  ||
            t.type === TokenType.SLASH   ||
            t.type === TokenType.RBRACKET) {
            this.evalAdvance();
            return;
        }

        // Multi-token: consume until STMTSEP or EOF.
        this.evalAdvance();
        let depth   = 0;
        let lastPos = this.evalPos;
        while (this.evalPeek().type !== TokenType.EOF &&
               this.evalPeek().type !== TokenType.STMTSEP) {
            const cur = this.evalPeek();
            if (cur.type === TokenType.LPAREN || cur.type === TokenType.LBRACKET ||
                cur.type === TokenType.LBRACE) {
                depth++; this.evalAdvance();
            } else if (cur.type === TokenType.RPAREN || cur.type === TokenType.RBRACE) {
                if (depth > 0) { depth--; this.evalAdvance(); }
                else this.evalAdvance();
            } else if (cur.type === TokenType.RBRACKET) {
                if (depth > 0) { depth--; this.evalAdvance(); }
                else break; // ] at depth 0 is RETURN — don't consume
            } else {
                this.evalAdvance();
            }
            if (this.evalPos === lastPos) break; // safety: prevent infinite loop
            lastPos = this.evalPos;
        }
    },

});
