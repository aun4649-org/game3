// ============================================================
// runtime-evaluator.js — Arithmetic expression evaluator
// ============================================================
// Recursive-descent parser for the COSMOS II expression grammar.
// Operator precedence (lowest → highest):
//   bitwise-OR  |  bitwise-XOR  ^  bitwise-AND  &
//   comparison  ==  <>  <  >  <=  >=
//   shift       <<  >>
//   add/sub     +  -
//   mul/div     *  /
//   unary       +  -  #(not)  ##(bnot)
//   primary     number  string  variable  array-ref  input  ( )
//
// Also contains the assignment-target parser and assignToTarget.
// ============================================================

Object.assign(CosmosRuntime.prototype, {

    // ---------- Evaluation Cursor ---------------------------
    // evalTokens / evalPos are instance state shared across all eval methods.

    initEval(tokens, startPos = 0) {
        this.evalTokens = tokens;
        this.evalPos    = startPos;
    },

    evalPeek() {
        return this.evalPos < this.evalTokens.length
            ? this.evalTokens[this.evalPos]
            : EOF_TOKEN;
    },

    evalAdvance() {
        return this.evalPos < this.evalTokens.length
            ? this.evalTokens[this.evalPos++]
            : EOF_TOKEN;
    },

    evalExpect(type) {
        const t = this.evalPeek();
        if (t.type !== type) throw this.syntaxError("Undefined syntax", t.pos);
        return this.evalAdvance();
    },

    // ---------- Expression (bitwise OR) ---------------------

    async evalExpression() {
        let left = await this.evalBitwiseXor();
        while (this.evalPeek().type === TokenType.OP_OR) {
            this.evalAdvance();
            left = toInt32(left | await this.evalBitwiseXor());
        }
        return left;
    },

    async evalBitwiseXor() {
        let left = await this.evalBitwiseAnd();
        while (this.evalPeek().type === TokenType.OP_XOR) {
            this.evalAdvance();
            left = toInt32(left ^ await this.evalBitwiseAnd());
        }
        return left;
    },

    async evalBitwiseAnd() {
        let left = await this.evalComparison();
        while (this.evalPeek().type === TokenType.OP_AND) {
            this.evalAdvance();
            left = toInt32(left & await this.evalComparison());
        }
        return left;
    },

    async evalComparison() {
        let left = await this.evalShift();
        while (true) {
            const t = this.evalPeek();
            switch (t.type) {
                case TokenType.OP_EQ: this.evalAdvance(); left = (left === await this.evalShift()) ? 1 : 0; break;
                case TokenType.OP_NE: this.evalAdvance(); left = (left !== await this.evalShift()) ? 1 : 0; break;
                case TokenType.OP_LT: this.evalAdvance(); left = (left  <  await this.evalShift()) ? 1 : 0; break;
                case TokenType.OP_GT: this.evalAdvance(); left = (left  >  await this.evalShift()) ? 1 : 0; break;
                case TokenType.OP_LE: this.evalAdvance(); left = (left  <= await this.evalShift()) ? 1 : 0; break;
                case TokenType.OP_GE: this.evalAdvance(); left = (left  >= await this.evalShift()) ? 1 : 0; break;
                default: return left;
            }
        }
    },

    async evalShift() {
        let left = await this.evalAddSub();
        while (true) {
            const t = this.evalPeek();
            if (t.type === TokenType.OP_SHL) {
                this.evalAdvance();
                left = toInt32(left << (await this.evalAddSub() & 31));
            } else if (t.type === TokenType.OP_SHR) {
                this.evalAdvance();
                left = toInt32(left >> (await this.evalAddSub() & 31));
            } else break;
        }
        return left;
    },

    async evalAddSub() {
        let left = await this.evalMulDiv();
        while (true) {
            const t = this.evalPeek();
            if (t.type === TokenType.OP_PLUS) {
                this.evalAdvance();
                left = toInt32(left + await this.evalMulDiv());
            } else if (t.type === TokenType.OP_MINUS) {
                this.evalAdvance();
                left = toInt32(left - await this.evalMulDiv());
            } else break;
        }
        return left;
    },

    async evalMulDiv() {
        let left = await this.evalUnary();
        while (true) {
            const t = this.evalPeek();
            if (t.type === TokenType.OP_MUL) {
                this.evalAdvance();
                left = toInt32(Math.imul(left, await this.evalUnary()));
            } else if (t.type === TokenType.SLASH) {
                this.evalAdvance();
                const right = await this.evalUnary();
                if (right === 0) throw this.runtimeError("Division by zero");
                this.systemVarRemainder = toInt32(left % right);
                left = toInt32(Math.trunc(left / right));
            } else break;
        }
        return left;
    },

    async evalUnary() {
        const t = this.evalPeek();
        if (t.type === TokenType.OP_PLUS) {
            this.evalAdvance();
            return toInt32(Math.abs(await this.evalUnary()));
        }
        if (t.type === TokenType.OP_MINUS) {
            this.evalAdvance();
            return toInt32(-(await this.evalUnary()));
        }
        if (t.type === TokenType.OP_NOT) {
            this.evalAdvance();
            const v = await this.evalUnary();
            return v === 0 ? 1 : 0;
        }
        if (t.type === TokenType.OP_BNOT) {
            this.evalAdvance();
            return toInt32(~(await this.evalUnary()));
        }
        return await this.evalPrimary();
    },

    // ---------- Primary -------------------------------------

    async evalPrimary() {
        const t = this.evalPeek();

        if (t.type === TokenType.NUMBER) {
            this.evalAdvance();
            return toInt32(t.value);
        }

        // String literal in expression context: returns char code of first char.
        if (t.type === TokenType.STRING) {
            this.evalAdvance();
            return t.value.length > 0 ? t.value.charCodeAt(0) : 0;
        }

        if (t.type === TokenType.SYSVAR_REM) {
            this.evalAdvance();
            return this.systemVarRemainder;
        }

        // ' — random 32-bit signed integer
        if (t.type === TokenType.SYSVAR_RND) {
            this.evalAdvance();
            const lo = Math.floor(Math.random() * 0x10000);
            const hi = Math.floor(Math.random() * 0x10000);
            return toInt32((hi << 16) | lo);
        }

        if (t.type === TokenType.VARIABLE) {
            this.evalAdvance();
            const varName = t.value;
            const next    = this.evalPeek();

            if (next.type === TokenType.LBRACKET) {        // V[expr] — byte read
                this.evalAdvance();
                const idx = await this.evalExpression();
                this.evalExpect(TokenType.RBRACKET);
                return this.memReadByte(toUint32(this.getVar(varName)) + toInt32(idx));
            }
            if (next.type === TokenType.COLON) {            // V:expr] — word read
                this.evalAdvance();
                const idx = await this.evalExpression();
                this.evalExpect(TokenType.RBRACKET);
                return this.memReadWordAddr(toUint32(this.getVar(varName)) + toInt32(idx) * 2);
            }
            if (next.type === TokenType.LBRACE) {           // V{expr} — dword read
                this.evalAdvance();
                const idx = await this.evalExpression();
                this.evalExpect(TokenType.RBRACE);
                return this.memReadDwordAddr(toUint32(this.getVar(varName)) + toInt32(idx) * 4);
            }
            return this.getVar(varName);
        }

        if (t.type === TokenType.LPAREN) {
            this.evalAdvance();
            const val = await this.evalExpression();
            this.evalExpect(TokenType.RPAREN);
            return val;
        }

        // ? — numeric input (returns user-entered integer)
        if (t.type === TokenType.QUESTION) {
            this.evalAdvance();
            const val = await runtimeInputNumber();
            if (val && val.interrupted) throw this.interruptError();
            return toInt32(val);
        }

        // $ — character input (returns char code)
        if (t.type === TokenType.DOLLAR) {
            this.evalAdvance();
            const val = await runtimeInputChar();
            if (val && val.interrupted) throw this.interruptError();
            return toInt32(val);
        }

        throw this.syntaxError("Undefined syntax", t.pos);
    },

    // ---------- Assignment Target Parser --------------------
    // Parses the left-hand side of an assignment: var, V[idx], V:idx], V{idx}

    async evalAssignTarget() {
        const t = this.evalPeek();
        if (t.type !== TokenType.VARIABLE) throw this.syntaxError("Undefined syntax", t.pos);
        this.evalAdvance();
        const varName = t.value;
        const next    = this.evalPeek();

        if (next.type === TokenType.LBRACKET) {
            this.evalAdvance();
            const idx = await this.evalExpression();
            this.evalExpect(TokenType.RBRACKET);
            return { type: 'byte', name: varName, index: idx };
        }
        if (next.type === TokenType.COLON) {
            this.evalAdvance();
            const idx = await this.evalExpression();
            this.evalExpect(TokenType.RBRACKET);
            return { type: 'word', name: varName, index: idx };
        }
        if (next.type === TokenType.LBRACE) {
            this.evalAdvance();
            const idx = await this.evalExpression();
            this.evalExpect(TokenType.RBRACE);
            return { type: 'dword', name: varName, index: idx };
        }
        return { type: 'var', name: varName };
    },

    assignToTarget(target, value) {
        value = toInt32(value);
        switch (target.type) {
            case 'var':
                this.setVar(target.name, value);
                break;
            case 'byte': {
                const addr = toUint32(this.getVar(target.name)) + toInt32(target.index);
                this.memWriteByte(addr, value);
                break;
            }
            case 'word': {
                const addr = toUint32(this.getVar(target.name)) + toInt32(target.index) * 2;
                this.memWriteWordAddr(addr, value);
                break;
            }
            case 'dword': {
                const addr = toUint32(this.getVar(target.name)) + toInt32(target.index) * 4;
                this.memWriteDwordAddr(addr, value);
                break;
            }
        }
    },

});
