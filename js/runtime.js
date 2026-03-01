// ============================================================
// runtime.js — COSMOS II Interpreter Runtime Engine
// ============================================================
// Tokenizer, Parser, Evaluator, Executor for the COSMOS II
// language (32-bit signed integer version).
// ============================================================

// ======================== HELPERS ============================

function toInt32(v) {
    return v | 0;
}

function toUint32(v) {
    return v >>> 0;
}

// ======================== TOKENIZER ==========================

const TokenType = {
    NUMBER: 'NUMBER',       // decimal / hex / binary / char literal
    VARIABLE: 'VARIABLE',   // A-Z, a-z
    SYSVAR_REM: 'SYSVAR_REM',   // %  (remainder)
    SYSVAR_RND: 'SYSVAR_RND',   // '  (random)
    OP_PLUS: 'OP_PLUS',
    OP_MINUS: 'OP_MINUS',
    OP_MUL: 'OP_MUL',
    OP_DIV: 'OP_DIV',
    OP_EQ: 'OP_EQ',         // ==
    OP_NE: 'OP_NE',         // <>
    OP_LT: 'OP_LT',         // <
    OP_GT: 'OP_GT',         // >
    OP_LE: 'OP_LE',         // <=
    OP_GE: 'OP_GE',         // >=
    OP_AND: 'OP_AND',       // &&
    OP_OR: 'OP_OR',         // ||
    OP_XOR: 'OP_XOR',       // ^
    OP_SHL: 'OP_SHL',       // <<
    OP_SHR: 'OP_SHR',       // >>
    OP_NOT: 'OP_NOT',       // # (logical not, unary)
    OP_BNOT: 'OP_BNOT',     // ## (bitwise not, unary)
    ASSIGN: 'ASSIGN',       // = (assignment)
    LPAREN: 'LPAREN',       // (
    RPAREN: 'RPAREN',       // )
    LBRACKET: 'LBRACKET',   // [
    RBRACKET: 'RBRACKET',   // ]
    LBRACE: 'LBRACE',       // {
    RBRACE: 'RBRACE',       // }
    COLON: 'COLON',         // :
    COMMA: 'COMMA',         // ,
    SEMICOLON: 'SEMICOLON', // ;
    AT: 'AT',               // @
    BANG: 'BANG',            // !
    QUESTION: 'QUESTION',   // ?
    DOLLAR: 'DOLLAR',       // $
    DOT: 'DOT',             // .
    SLASH: 'SLASH',         // / (also used as newline output)
    DQUOTE: 'DQUOTE',       // "
    STRING: 'STRING',       // string literal content
    DQUESTION: 'DQUESTION', // ??
    QDOLLAR: 'QDOLLAR',     // ?$
    QZERO: 'QZERO',        // ?0
    EOF: 'EOF',
};

class Token {
    constructor(type, value, pos) {
        this.type = type;
        this.value = value;
        this.pos = pos;     // character position in the source line
    }
}

class Tokenizer {
    constructor(source) {
        this.src = source;
        this.pos = 0;
        this.tokens = [];
    }

    peek() {
        return this.pos < this.src.length ? this.src[this.pos] : null;
    }

    advance() {
        return this.src[this.pos++];
    }

    isDigit(ch) {
        return ch >= '0' && ch <= '9';
    }

    isAlpha(ch) {
        return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z');
    }

    isHexDigit(ch) {
        return this.isDigit(ch) || (ch >= 'A' && ch <= 'F') || (ch >= 'a' && ch <= 'f');
    }

    tokenize() {
        this.tokens = [];
        while (this.pos < this.src.length) {
            const startPos = this.pos;
            const ch = this.peek();

            // Check for inline comments: //, ##, --
            if (this.pos + 1 < this.src.length) {
                const nextCh = this.src[this.pos + 1];
                if ((ch === '/' && nextCh === '/') ||
                    (ch === '#' && nextCh === '#') ||
                    (ch === '-' && nextCh === '-')) {
                    // It's a comment, ignore the rest of the line
                    break;
                }
            }

            // Skip spaces
            if (ch === ' ') {
                this.advance();
                continue;
            }

            // String literal: "..."
            if (ch === '"') {
                this.advance(); // skip opening "
                let str = '';
                while (this.pos < this.src.length && this.peek() !== '"') {
                    str += this.advance();
                }
                if (this.pos < this.src.length && this.peek() === '"') {
                    this.advance(); // skip closing "
                }
                this.tokens.push(new Token(TokenType.STRING, str, startPos));
                continue;
            }

            // Character literal: "X" — handled as part of string processing above
            // Actually, in the language spec, "X" is char literal when single char.
            // We handle this in the parser/evaluator.

            // Decimal number
            if (this.isDigit(ch)) {
                let num = '';
                while (this.pos < this.src.length && this.isDigit(this.peek())) {
                    num += this.advance();
                }
                this.tokens.push(new Token(TokenType.NUMBER, parseInt(num, 10), startPos));
                continue;
            }

            // $ — hex constant prefix or dollar sign
            if (ch === '$') {
                // Peek next: if hex digit, it's a hex constant
                if (this.pos + 1 < this.src.length && this.isHexDigit(this.src[this.pos + 1])) {
                    this.advance(); // skip $
                    let hex = '';
                    while (this.pos < this.src.length && this.isHexDigit(this.peek())) {
                        hex += this.advance();
                    }
                    // Interpret as 32-bit two's complement
                    let val = parseInt(hex, 16);
                    if (val > 0x7FFFFFFF) {
                        val = val - 0x100000000;
                    }
                    this.tokens.push(new Token(TokenType.NUMBER, toInt32(val), startPos));
                    continue;
                }
                this.advance();
                this.tokens.push(new Token(TokenType.DOLLAR, '$', startPos));
                continue;
            }

            // % — binary constant or system variable
            if (ch === '%') {
                // Check next char: if 0 or 1, binary constant
                if (this.pos + 1 < this.src.length &&
                    (this.src[this.pos + 1] === '0' || this.src[this.pos + 1] === '1')) {
                    this.advance(); // skip %
                    let bin = '';
                    while (this.pos < this.src.length &&
                        (this.peek() === '0' || this.peek() === '1')) {
                        bin += this.advance();
                    }
                    let val = parseInt(bin, 2);
                    if (bin.length === 32 && bin[0] === '1') {
                        val = val - 0x100000000;
                    }
                    this.tokens.push(new Token(TokenType.NUMBER, toInt32(val), startPos));
                    continue;
                }
                this.advance();
                this.tokens.push(new Token(TokenType.SYSVAR_REM, '%', startPos));
                continue;
            }

            // ' — random system variable
            if (ch === "'") {
                this.advance();
                this.tokens.push(new Token(TokenType.SYSVAR_RND, "'", startPos));
                continue;
            }

            // Variable name (A-Z, a-z)
            if (this.isAlpha(ch)) {
                const varName = this.advance();
                // Skip subsequent alphanumeric (only first char matters)
                while (this.pos < this.src.length && this.isAlpha(this.peek())) {
                    this.advance();
                }
                this.tokens.push(new Token(TokenType.VARIABLE, varName, startPos));
                continue;
            }

            // Two-character operators
            if (ch === '=' && this.pos + 1 < this.src.length && this.src[this.pos + 1] === '=') {
                this.advance(); this.advance();
                this.tokens.push(new Token(TokenType.OP_EQ, '==', startPos));
                continue;
            }
            if (ch === '<') {
                this.advance();
                if (this.peek() === '>') {
                    this.advance();
                    this.tokens.push(new Token(TokenType.OP_NE, '<>', startPos));
                } else if (this.peek() === '=') {
                    this.advance();
                    this.tokens.push(new Token(TokenType.OP_LE, '<=', startPos));
                } else if (this.peek() === '<') {
                    this.advance();
                    this.tokens.push(new Token(TokenType.OP_SHL, '<<', startPos));
                } else {
                    this.tokens.push(new Token(TokenType.OP_LT, '<', startPos));
                }
                continue;
            }
            if (ch === '>') {
                this.advance();
                if (this.peek() === '=') {
                    this.advance();
                    this.tokens.push(new Token(TokenType.OP_GE, '>=', startPos));
                } else if (this.peek() === '>') {
                    this.advance();
                    this.tokens.push(new Token(TokenType.OP_SHR, '>>', startPos));
                } else {
                    this.tokens.push(new Token(TokenType.OP_GT, '>', startPos));
                }
                continue;
            }
            if (ch === '&' && this.pos + 1 < this.src.length && this.src[this.pos + 1] === '&') {
                this.advance(); this.advance();
                this.tokens.push(new Token(TokenType.OP_AND, '&&', startPos));
                continue;
            }
            if (ch === '|' && this.pos + 1 < this.src.length && this.src[this.pos + 1] === '|') {
                this.advance(); this.advance();
                this.tokens.push(new Token(TokenType.OP_OR, '||', startPos));
                continue;
            }

            // # — ## (bitwise NOT) or # (logical NOT or GOTO)
            if (ch === '#') {
                this.advance();
                if (this.peek() === '#') {
                    this.advance();
                    this.tokens.push(new Token(TokenType.OP_BNOT, '##', startPos));
                } else {
                    this.tokens.push(new Token(TokenType.OP_NOT, '#', startPos));
                }
                continue;
            }

            // ? — ??, ?$, ?0, or plain question
            if (ch === '?') {
                this.advance();
                if (this.peek() === '?') {
                    this.advance();
                    this.tokens.push(new Token(TokenType.DQUESTION, '??', startPos));
                } else if (this.peek() === '$') {
                    this.advance();
                    this.tokens.push(new Token(TokenType.QDOLLAR, '?$', startPos));
                } else if (this.peek() === '0') {
                    this.advance();
                    this.tokens.push(new Token(TokenType.QZERO, '?0', startPos));
                } else {
                    this.tokens.push(new Token(TokenType.QUESTION, '?', startPos));
                }
                continue;
            }

            // Single character tokens
            const singleMap = {
                '+': TokenType.OP_PLUS,
                '-': TokenType.OP_MINUS,
                '*': TokenType.OP_MUL,
                '/': TokenType.SLASH,
                '^': TokenType.OP_XOR,
                '=': TokenType.ASSIGN,
                '(': TokenType.LPAREN,
                ')': TokenType.RPAREN,
                '[': TokenType.LBRACKET,
                ']': TokenType.RBRACKET,
                '{': TokenType.LBRACE,
                '}': TokenType.RBRACE,
                ':': TokenType.COLON,
                ',': TokenType.COMMA,
                ';': TokenType.SEMICOLON,
                '@': TokenType.AT,
                '!': TokenType.BANG,
                '.': TokenType.DOT,
            };

            if (singleMap[ch]) {
                this.advance();
                this.tokens.push(new Token(singleMap[ch], ch, startPos));
                continue;
            }

            // Unknown character
            this.advance();
            this.tokens.push(new Token('UNKNOWN', ch, startPos));
        }

        this.tokens.push(new Token(TokenType.EOF, null, this.pos));
        return this.tokens;
    }
}

// ======================== RUNTIME CONTEXT ====================

class CosmosRuntime {
    constructor(programMemory, memory) {
        this.programMemory = programMemory;
        this.memory = memory;
        this.systemVarRemainder = 0;
        this.callStack = [];
        this.loopStack = [];
        this.pc = -1;
        this.stmtIndex = 0;
        this.sortedLines = [];
        this.running = false;
        this.MAX_STACK = 256;

        // Parsed statements cache: lineNo -> array of statement token arrays
        this.statementsCache = {};
    }

    // ---------- Memory Access ----------

    memReadByte(addr) {
        addr = toUint32(addr);
        if (addr > 0xFFFF) {
            throw this.runtimeError("Address out of range");
        }
        return this.memory[addr];
    }

    memWriteByte(addr, value) {
        addr = toUint32(addr);
        if (addr > 0xFFFF) {
            throw this.runtimeError("Address out of range");
        }
        this.memory[addr] = value & 0xFF;
    }

    memReadWordAddr(addr) {
        addr = toUint32(addr);
        if (addr > 0xFFFF || addr + 1 > 0xFFFF) {
            throw this.runtimeError("Address out of range");
        }
        const u = (this.memory[addr] << 8) | this.memory[addr + 1];
        return (u << 16) >> 16;
    }

    memWriteWordAddr(addr, value) {
        addr = toUint32(addr);
        if (addr > 0xFFFF || addr + 1 > 0xFFFF) {
            throw this.runtimeError("Address out of range");
        }
        const v = value & 0xFFFF;
        this.memory[addr] = (v >> 8) & 0xFF;
        this.memory[addr + 1] = v & 0xFF;
    }

    memReadDwordAddr(addr) {
        addr = toUint32(addr);
        if (addr + 3 > 0xFFFF) {
            throw this.runtimeError("Address out of range");
        }
        const u = (this.memory[addr] << 24) | (this.memory[addr + 1] << 16) |
            (this.memory[addr + 2] << 8) | this.memory[addr + 3];
        return u | 0;
    }

    memWriteDwordAddr(addr, value) {
        addr = toUint32(addr);
        if (addr + 3 > 0xFFFF) {
            throw this.runtimeError("Address out of range");
        }
        const v = value | 0;
        this.memory[addr] = (v >>> 24) & 0xFF;
        this.memory[addr + 1] = (v >>> 16) & 0xFF;
        this.memory[addr + 2] = (v >>> 8) & 0xFF;
        this.memory[addr + 3] = v & 0xFF;
    }

    getVarAddr(name) {
        const ch = name.charCodeAt(0);
        if (ch >= 65 && ch <= 90) return (ch - 65) * 4;
        if (ch >= 97 && ch <= 122) return 0x0068 + (ch - 97) * 4;
        return -1;
    }

    getVar(name) {
        const addr = this.getVarAddr(name);
        if (addr < 0) return 0;
        return this.memReadDwordAddr(addr);
    }

    setVar(name, value) {
        const addr = this.getVarAddr(name);
        if (addr < 0) return;
        this.memWriteDwordAddr(addr, value);
    }

    // ---------- Error Helpers ----------

    syntaxError(msg, pos) {
        return {
            type: 'SYNTAX',
            message: `** SYNTAX ERROR : ${msg}`,
            pos: pos || 0
        };
    }

    runtimeError(msg) {
        return {
            type: 'RUNTIME',
            message: `** RUNTIME ERROR : ${msg}`,
            line: this.pc
        };
    }

    formatError(err, lineContent) {
        const lines = [err.message];
        if (lineContent !== undefined) {
            lines.push(lineContent);
            if (err.pos !== undefined) {
                lines.push(' '.repeat(err.pos) + '^');
            }
        }
        return lines;
    }

    // ---------- Statement Splitting ----------
    // Split a token array into statements separated by spaces at the top level

    splitStatements(tokens) {
        // In this language, statements are separated by whitespace.
        // The tokenizer already skips whitespace, so we look at the token stream
        // and determine statement boundaries based on the language grammar.
        // We'll use a simpler approach: parse statements one at a time from the
        // token stream during execution.
        return tokens;
    }

    // ---------- Tokenize & Cache ----------

    getLineTokens(lineNo) {
        if (!this.statementsCache[lineNo]) {
            const source = this.programMemory[lineNo];
            if (source === undefined) return null;
            const tokenizer = new Tokenizer(source);
            this.statementsCache[lineNo] = tokenizer.tokenize();
        }
        return this.statementsCache[lineNo];
    }

    // ---------- Expression Evaluator (Recursive Descent) ----------

    // Token stream state for evaluation
    initEval(tokens, pos) {
        this.evalTokens = tokens;
        this.evalPos = pos || 0;
    }

    evalPeek() {
        if (this.evalPos < this.evalTokens.length) {
            return this.evalTokens[this.evalPos];
        }
        return new Token(TokenType.EOF, null, -1);
    }

    evalAdvance() {
        if (this.evalPos >= this.evalTokens.length) {
            return new Token(TokenType.EOF, null, -1);
        }
        const t = this.evalTokens[this.evalPos];
        this.evalPos++;
        return t;
    }

    evalExpect(type) {
        const t = this.evalPeek();
        if (t.type !== type) {
            throw this.syntaxError("Undefined syntax", t.pos);
        }
        return this.evalAdvance();
    }

    // Expression: bitwise OR level
    async evalExpression() {
        let left = await this.evalBitwiseXor();
        while (this.evalPeek().type === TokenType.OP_OR) {
            this.evalAdvance();
            const right = await this.evalBitwiseXor();
            left = toInt32(left | right);
        }
        return left;
    }

    // Bitwise XOR
    async evalBitwiseXor() {
        let left = await this.evalBitwiseAnd();
        while (this.evalPeek().type === TokenType.OP_XOR) {
            this.evalAdvance();
            const right = await this.evalBitwiseAnd();
            left = toInt32(left ^ right);
        }
        return left;
    }

    // Bitwise AND
    async evalBitwiseAnd() {
        let left = await this.evalComparison();
        while (this.evalPeek().type === TokenType.OP_AND) {
            this.evalAdvance();
            const right = await this.evalComparison();
            left = toInt32(left & right);
        }
        return left;
    }

    // Comparison
    async evalComparison() {
        let left = await this.evalShift();
        while (true) {
            const t = this.evalPeek();
            if (t.type === TokenType.OP_EQ) {
                this.evalAdvance();
                const right = await this.evalShift();
                left = (left === right) ? 1 : 0;
            } else if (t.type === TokenType.OP_NE) {
                this.evalAdvance();
                const right = await this.evalShift();
                left = (left !== right) ? 1 : 0;
            } else if (t.type === TokenType.OP_LT) {
                this.evalAdvance();
                const right = await this.evalShift();
                left = (left < right) ? 1 : 0;
            } else if (t.type === TokenType.OP_GT) {
                this.evalAdvance();
                const right = await this.evalShift();
                left = (left > right) ? 1 : 0;
            } else if (t.type === TokenType.OP_LE) {
                this.evalAdvance();
                const right = await this.evalShift();
                left = (left <= right) ? 1 : 0;
            } else if (t.type === TokenType.OP_GE) {
                this.evalAdvance();
                const right = await this.evalShift();
                left = (left >= right) ? 1 : 0;
            } else {
                break;
            }
        }
        return left;
    }

    // Shift
    async evalShift() {
        let left = await this.evalAddSub();
        while (true) {
            const t = this.evalPeek();
            if (t.type === TokenType.OP_SHL) {
                this.evalAdvance();
                const right = await this.evalAddSub();
                left = toInt32(left << (right & 31));
            } else if (t.type === TokenType.OP_SHR) {
                this.evalAdvance();
                const right = await this.evalAddSub();
                left = toInt32(left >> (right & 31));
            } else {
                break;
            }
        }
        return left;
    }

    // Add / Sub
    async evalAddSub() {
        let left = await this.evalMulDiv();
        while (true) {
            const t = this.evalPeek();
            if (t.type === TokenType.OP_PLUS) {
                this.evalAdvance();
                const right = await this.evalMulDiv();
                left = toInt32(left + right);
            } else if (t.type === TokenType.OP_MINUS) {
                this.evalAdvance();
                const right = await this.evalMulDiv();
                left = toInt32(left - right);
            } else {
                break;
            }
        }
        return left;
    }

    // Mul / Div
    async evalMulDiv() {
        let left = await this.evalUnary();
        while (true) {
            const t = this.evalPeek();
            if (t.type === TokenType.OP_MUL) {
                this.evalAdvance();
                const right = await this.evalUnary();
                left = toInt32(Math.imul(left, right));
            } else if (t.type === TokenType.SLASH) {
                this.evalAdvance();
                const right = await this.evalUnary();
                if (right === 0) {
                    throw this.runtimeError("Division by zero");
                }
                this.systemVarRemainder = toInt32(left % right);
                left = toInt32(Math.trunc(left / right));
            } else {
                break;
            }
        }
        return left;
    }

    // Unary
    async evalUnary() {
        const t = this.evalPeek();
        if (t.type === TokenType.OP_PLUS) {
            this.evalAdvance();
            const val = await this.evalUnary();
            return toInt32(Math.abs(val));
        }
        if (t.type === TokenType.OP_MINUS) {
            this.evalAdvance();
            const val = await this.evalUnary();
            return toInt32(-val);
        }
        if (t.type === TokenType.OP_NOT) {
            // Could be # (unary logical not) — need to check it's not ## 
            this.evalAdvance();
            const val = await this.evalUnary();
            return val === 0 ? 1 : 0;
        }
        if (t.type === TokenType.OP_BNOT) {
            this.evalAdvance();
            const val = await this.evalUnary();
            return toInt32(~val);
        }
        return await this.evalPrimary();
    }

    // Primary
    async evalPrimary() {
        const t = this.evalPeek();

        // Number literal
        if (t.type === TokenType.NUMBER) {
            this.evalAdvance();
            return toInt32(t.value);
        }

        // String literal (single char = char literal)
        if (t.type === TokenType.STRING) {
            this.evalAdvance();
            if (t.value.length === 1) {
                return t.value.charCodeAt(0);
            }
            // Multi-char string in expression context: return first char
            return t.value.length > 0 ? t.value.charCodeAt(0) : 0;
        }

        // System variable %
        if (t.type === TokenType.SYSVAR_REM) {
            this.evalAdvance();
            return this.systemVarRemainder;
        }

        // System variable ' (random)
        if (t.type === TokenType.SYSVAR_RND) {
            this.evalAdvance();
            // Random 32-bit signed integer
            const lo = Math.floor(Math.random() * 0x10000);
            const hi = Math.floor(Math.random() * 0x10000);
            return toInt32((hi << 16) | lo);
        }

        // Variable (possibly with array ref)
        if (t.type === TokenType.VARIABLE) {
            this.evalAdvance();
            const varName = t.value;
            const next = this.evalPeek();

            // Byte array reference: V[expr]
            if (next.type === TokenType.LBRACKET) {
                this.evalAdvance(); // skip [
                const index = await this.evalExpression();
                this.evalExpect(TokenType.RBRACKET);
                const baseAddr = toUint32(this.getVar(varName));
                const addr = baseAddr + toInt32(index);
                return this.memReadByte(addr);
            }

            // Word array reference: V:expr]
            if (next.type === TokenType.COLON) {
                this.evalAdvance(); // skip :
                const index = await this.evalExpression();
                this.evalExpect(TokenType.RBRACKET);
                const baseAddr = toUint32(this.getVar(varName));
                const addr = baseAddr + toInt32(index) * 2;
                return this.memReadWordAddr(addr);
            }

            // Dword array reference: V{expr}
            if (next.type === TokenType.LBRACE) {
                this.evalAdvance(); // skip {
                const index = await this.evalExpression();
                this.evalExpect(TokenType.RBRACE);
                const baseAddr = toUint32(this.getVar(varName));
                const addr = baseAddr + toInt32(index) * 4;
                return this.memReadDwordAddr(addr);
            }

            // Simple variable
            return this.getVar(varName);
        }

        // Parenthesized expression
        if (t.type === TokenType.LPAREN) {
            this.evalAdvance();
            const val = await this.evalExpression();
            this.evalExpect(TokenType.RPAREN);
            return val;
        }

        // ? — numeric input
        if (t.type === TokenType.QUESTION) {
            this.evalAdvance();
            const val = await runtimeInputNumber();
            if (val && val.interrupted) throw this.runtimeError("Program interrupted");
            return toInt32(val);
        }

        // $ — character input
        if (t.type === TokenType.DOLLAR) {
            this.evalAdvance();
            const val = await runtimeInputChar();
            if (val && val.interrupted) throw this.runtimeError("Program interrupted");
            return toInt32(val);
        }

        throw this.syntaxError("Undefined syntax", t.pos);
    }

    // ---------- Assignment Target Parser ----------
    // Returns { type: 'var'|'byte'|'word'|'dword', name, indexTokensStart, indexTokensEnd }

    async evalAssignTarget() {
        const t = this.evalPeek();
        if (t.type !== TokenType.VARIABLE) {
            throw this.syntaxError("Undefined syntax", t.pos);
        }
        this.evalAdvance();
        const varName = t.value;
        const next = this.evalPeek();

        if (next.type === TokenType.LBRACKET) {
            this.evalAdvance();
            const index = await this.evalExpression();
            this.evalExpect(TokenType.RBRACKET);
            return { type: 'byte', name: varName, index: index };
        }
        if (next.type === TokenType.COLON) {
            this.evalAdvance();
            const index = await this.evalExpression();
            this.evalExpect(TokenType.RBRACKET);
            return { type: 'word', name: varName, index: index };
        }
        if (next.type === TokenType.LBRACE) {
            this.evalAdvance();
            const index = await this.evalExpression();
            this.evalExpect(TokenType.RBRACE);
            return { type: 'dword', name: varName, index: index };
        }
        return { type: 'var', name: varName };
    }

    assignToTarget(target, value) {
        value = toInt32(value);
        if (target.type === 'var') {
            this.setVar(target.name, value);
        } else if (target.type === 'byte') {
            const baseAddr = toUint32(this.getVar(target.name));
            const addr = baseAddr + toInt32(target.index);
            this.memWriteByte(addr, value);
        } else if (target.type === 'word') {
            const baseAddr = toUint32(this.getVar(target.name));
            const addr = baseAddr + toInt32(target.index) * 2;
            this.memWriteWordAddr(addr, value);
        } else if (target.type === 'dword') {
            const baseAddr = toUint32(this.getVar(target.name));
            const addr = baseAddr + toInt32(target.index) * 4;
            this.memWriteDwordAddr(addr, value);
        }
    }

    // ---------- GOTO/GOSUB Line Resolution ----------

    findLine(targetLineNo) {
        targetLineNo = toInt32(targetLineNo);
        if (targetLineNo === -1) return -1; // END

        // Find exact or next-higher line
        for (let i = 0; i < this.sortedLines.length; i++) {
            const line = this.sortedLines[i];
            if (line <= 0) continue; // Exclude direct-mode injected line (0)
            if (line >= targetLineNo) {
                return line;
            }
        }
        return null; // no matching line
    }

    // ---------- Statement Execution ----------

    async executeStatement() {
        const t = this.evalPeek();

        // ---- String Output: "..." ----
        if (t.type === TokenType.STRING) {
            this.evalAdvance();
            runtimePrint(t.value);
            // If the next token is EOF, we should let the main loop handle it, but
            // returning NEXT is correct because if the next token is EOF, the main loop
            // will naturally break on `while (this.evalPeek().type !== TokenType.EOF)`.
            // Wait, why didn't it break? Ah, because evalPos did not advance relative
            // to the *start* of the loop, because we returned NEXT, which increments
            // currentStmt, but the *next* statement was EOF, which didn't consume anything.
            // Oh, no! The statement string consumptions DID advance evalPos.
            // But wait, what if currentStmt was incremented, but skipToStmt was higher?
            // Let's just return NEXT.
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
            if (this.callStack.length === 0) {
                throw this.runtimeError("Stack underflow");
            }
            const ret = this.callStack.pop();
            this.pc = ret.pc;
            this.stmtIndex = ret.stmtIndex;
            // We need to continue to next statement from the saved position
            return 'RETURNED';
        }

        // ---- GOTO: #=<expr> ----
        if (t.type === TokenType.OP_NOT) {
            this.evalAdvance();
            // Check for ## (bitwise not) — no, # in statement context is GOTO
            // Actually we need to distinguish: "#=" is GOTO, "#" as unary in expression
            // In statement context, # followed by = is GOTO
            if (this.evalPeek().type === TokenType.ASSIGN) {
                this.evalAdvance(); // skip =
                const val = await this.evalExpression();
                const target = this.findLine(val);
                if (target === -1) return 'END';
                if (target === null) {
                    throw this.runtimeError("Mismatched control blocks");
                }
                this.pc = target;
                this.stmtIndex = 0;
                return 'JUMPED';
            }
            // Otherwise it's not a valid statement start
            throw this.syntaxError("Undefined syntax", t.pos);
        }

        // ---- GOSUB: !=<expr> ----
        if (t.type === TokenType.BANG) {
            this.evalAdvance();
            this.evalExpect(TokenType.ASSIGN);
            const val = await this.evalExpression();
            const target = this.findLine(val);
            if (target === -1) return 'END';
            if (target === null) {
                throw this.runtimeError("Mismatched control blocks");
            }
            if (this.callStack.length >= this.MAX_STACK) {
                throw this.runtimeError("Stack overflow");
            }
            // Save return position (next statement)
            this.callStack.push({ pc: this.pc, stmtIndex: this.stmtIndex });
            this.pc = target;
            this.stmtIndex = 0;
            return 'JUMPED';
        }

        // ---- IF: ;=<expr> ----
        if (t.type === TokenType.SEMICOLON) {
            this.evalAdvance();
            this.evalExpect(TokenType.ASSIGN);
            const val = await this.evalExpression();
            if (val === 0) {
                return 'SKIP_LINE';
            }
            return 'NEXT';
        }

        // ---- DO/UNTIL/NEXT: @ ----
        if (t.type === TokenType.AT) {
            this.evalAdvance();
            const next = this.evalPeek();

            // @=(...) — UNTIL
            if (next.type === TokenType.ASSIGN) {
                this.evalAdvance(); // skip =
                const next2 = this.evalPeek();

                if (next2.type === TokenType.LPAREN) {
                    // UNTIL: @=(expr)
                    this.evalAdvance(); // skip (
                    const val = await this.evalExpression();
                    this.evalExpect(TokenType.RPAREN);

                    if (this.loopStack.length === 0) {
                        throw this.runtimeError("Mismatched control blocks");
                    }

                    if (val === 0) {
                        // Continue loop — jump back to DO
                        const loopTop = this.loopStack[this.loopStack.length - 1];
                        this.pc = loopTop.pc;
                        this.stmtIndex = loopTop.stmtIndex;
                        return 'JUMPED';
                    } else {
                        // Exit loop
                        this.loopStack.pop();
                        return 'NEXT';
                    }
                } else {
                    // NEXT: @=<expr> (FOR loop upper bound)
                    const upperBound = await this.evalExpression();

                    if (this.loopStack.length === 0) {
                        throw this.runtimeError("Mismatched control blocks");
                    }
                    const loopInfo = this.loopStack[this.loopStack.length - 1];
                    if (!loopInfo.forVar) {
                        throw this.runtimeError("Mismatched control blocks");
                    }

                    // Add step to variable
                    const step = loopInfo.step;
                    let newVal = toInt32(this.getVar(loopInfo.forVar) + step);
                    this.setVar(loopInfo.forVar, newVal);

                    // Check termination
                    let done = false;
                    if (step > 0) {
                        done = newVal > upperBound;
                    } else {
                        done = newVal < upperBound;
                    }

                    if (done) {
                        this.loopStack.pop();
                        return 'NEXT';
                    } else {
                        this.pc = loopInfo.pc;
                        this.stmtIndex = loopInfo.stmtIndex;
                        return 'JUMPED';
                    }
                }
            }

            // Plain @ — DO (loop start)
            this.loopStack.push({
                pc: this.pc,
                stmtIndex: this.stmtIndex
            });
            return 'NEXT';
        }

        // ---- Output statements ----

        // ?? = expr (hex 8-digit output)
        if (t.type === TokenType.DQUESTION) {
            this.evalAdvance();
            this.evalExpect(TokenType.ASSIGN);
            const val = await this.evalExpression();
            const hex = toUint32(val).toString(16).toUpperCase().padStart(8, '0');
            runtimePrint(hex);
            return 'NEXT';
        }

        // ?$ = expr (hex 2-digit output)
        if (t.type === TokenType.QDOLLAR) {
            this.evalAdvance();
            this.evalExpect(TokenType.ASSIGN);
            const val = await this.evalExpression();
            const hex = (val & 0xFF).toString(16).toUpperCase().padStart(2, '0');
            runtimePrint(hex);
            return 'NEXT';
        }

        // ?0(n)=expr (zero-padded decimal) 
        if (t.type === TokenType.QZERO) {
            this.evalAdvance();
            this.evalExpect(TokenType.LPAREN);
            const widthTok = this.evalPeek();
            if (widthTok.type !== TokenType.NUMBER) {
                throw this.syntaxError("Undefined syntax", widthTok.pos);
            }
            const width = widthTok.value;
            this.evalAdvance();
            this.evalExpect(TokenType.RPAREN);
            this.evalExpect(TokenType.ASSIGN);
            const val = await this.evalExpression();
            const neg = val < 0;
            const absStr = Math.abs(val).toString();
            const padLen = neg ? width - 1 : width;
            const padded = absStr.padStart(padLen, '0');
            runtimePrint(neg ? '-' + padded : padded);
            return 'NEXT';
        }

        // ?(n)=expr (space-padded decimal) or ?=expr (decimal output) or ? (input)
        if (t.type === TokenType.QUESTION) {
            this.evalAdvance();
            const next = this.evalPeek();

            if (next.type === TokenType.LPAREN) {
                // ?(n)=expr
                this.evalAdvance(); // skip (
                const widthTok = this.evalPeek();
                if (widthTok.type !== TokenType.NUMBER) {
                    throw this.syntaxError("Undefined syntax", widthTok.pos);
                }
                const width = widthTok.value;
                this.evalAdvance();
                this.evalExpect(TokenType.RPAREN);
                this.evalExpect(TokenType.ASSIGN);
                const val = await this.evalExpression();
                const str = val.toString();
                runtimePrint(str.padStart(width, ' '));
                return 'NEXT';
            }

            if (next.type === TokenType.ASSIGN) {
                // ?=expr (decimal output)
                this.evalAdvance(); // skip =
                const val = await this.evalExpression();
                runtimePrint(val.toString());
                return 'NEXT';
            }

            // ? alone in statement context — this shouldn't happen normally
            // (? as input is handled in primary expression)
            throw this.syntaxError("Undefined syntax", t.pos);
        }

        // $=expr (character output)
        if (t.type === TokenType.DOLLAR) {
            this.evalAdvance();
            this.evalExpect(TokenType.ASSIGN);
            const val = await this.evalExpression();
            runtimePrint(String.fromCharCode(val & 0x7F));
            return 'NEXT';
        }

        // .=expr (space output)
        if (t.type === TokenType.DOT) {
            this.evalAdvance();
            this.evalExpect(TokenType.ASSIGN);
            const val = await this.evalExpression();
            if (val > 0) {
                runtimePrint(' '.repeat(val));
            }
            return 'NEXT';
        }

        // ---- Assignment or FOR statement ----
        if (t.type === TokenType.VARIABLE) {
            const savedPos = this.evalPos;
            const target = await this.evalAssignTarget();
            this.evalExpect(TokenType.ASSIGN);
            const val = await this.evalExpression();
            this.assignToTarget(target, val);

            // Check for comma (FOR statement)
            if (this.evalPeek().type === TokenType.COMMA) {
                this.evalAdvance(); // skip ,
                const step = await this.evalExpression();
                // Push loop info
                this.loopStack.push({
                    pc: this.pc,
                    stmtIndex: this.stmtIndex,
                    forVar: target.name,
                    step: toInt32(step)
                });
            }

            return 'NEXT';
        }

        throw this.syntaxError("Undefined syntax", t.pos);
    }

    // ---------- Main Execution Loop ----------

    async run(clearMem = true) {
        this.statementsCache = {};
        this.callStack = [];
        this.loopStack = [];
        this.systemVarRemainder = 0;

        if (clearMem) {
            // Clear variables
            this.memory.fill(0, 0x0000, 0x00D0);
        }

        this.sortedLines = Object.keys(this.programMemory).map(Number).sort((a, b) => a - b);
        if (this.sortedLines.length === 0) {
            return "NO PROGRAM";
        }

        this.pc = this.sortedLines[0];
        this.stmtIndex = 0;
        this.running = true;

        try {
            while (this.running) {
                const lineNo = this.pc;

                // Check if we've run past the end
                if (this.sortedLines.indexOf(lineNo) === -1 &&
                    lineNo > this.sortedLines[this.sortedLines.length - 1]) {
                    break; // natural end
                }

                // Check for interrupt
                if (window.cosmosInterruptFlag) {
                    throw this.runtimeError("Program interrupted");
                }

                const source = this.programMemory[lineNo];
                if (source === undefined) {
                    break;
                }

                // Tokenize
                const tokenizer = new Tokenizer(source);
                const allTokens = tokenizer.tokenize();

                // Split into statements: we parse from current stmtIndex position
                // We need to track how many statements we've skipped
                this.initEval(allTokens, 0);

                // Yield to event loop once per line so the browser can process
                // key events (including CTRL+C) and repaint the screen.
                await new Promise(r => setTimeout(r, 0));

                // Render accumulated output since last yield. Calling renderScreen()
                // here (rather than inside runtimePrint/runtimePrintln) limits DOM
                // updates to at most once per line, preventing browser main-thread
                // saturation in tight output loops.
                if (typeof renderScreen === "function") renderScreen();

                // Skip to the right statement
                // For simplicity, we track statement boundaries:
                // Statements are separated by whitespace (already stripped by tokenizer).
                // We re-execute from stmtIndex perspective.

                // Actually, the simplest approach: parse all statements from the line
                // and execute them sequentially, handling jumps appropriately.

                let currentStmt = 0;
                let skipToStmt = this.stmtIndex;

                // Reset eval position for this line
                this.initEval(allTokens, 0);

                // Check for comment: first token must be a valid statement start
                const firstToken = this.evalPeek();
                if (firstToken.type === TokenType.EOF) {
                    // Empty line, move to next
                    this.advanceToNextLine();
                    continue;
                }

                // Check if line is a comment
                if (this.isComment(firstToken)) {
                    this.advanceToNextLine();
                    continue;
                }

                let jumped = false;
                while (this.evalPeek().type !== TokenType.EOF) {
                    const startPos = this.evalPos;

                    if (currentStmt < skipToStmt) {
                        // Need to skip this statement — fast-forward
                        this.skipOneStatement();
                        currentStmt++;
                        continue;
                    }

                    // Record current position for NEXT tracking
                    this.stmtIndex = currentStmt + 1; // next statement index

                    const result = await this.executeStatement();

                    // Check interrupt after each statement so CTRL+C pressed
                    // during async evaluation (e.g. input) is caught immediately.
                    if (window.cosmosInterruptFlag) {
                        throw this.runtimeError("Program interrupted");
                    }

                    switch (result) {
                        case 'NEXT':
                            currentStmt++;
                            break;
                        case 'SKIP_LINE':
                            jumped = true;
                            this.advanceToNextLine();
                            break;
                        case 'JUMPED':
                            jumped = true;
                            break;
                        case 'RETURNED':
                            jumped = true;
                            break;
                        case 'END':
                            this.running = false;
                            jumped = true;
                            break;
                    }
                    if (jumped) break;

                    // Safety check to prevent infinite loop on malformed statement endings
                    // If a statement completed but didn't consume any tokens, we're stuck.
                    // This can happen if executeStatement returns normally without advancing,
                    // e.g. a string statement that doesn't consume EOF cleanly.
                    if (this.evalPos === startPos && this.evalPeek().type !== TokenType.EOF) {
                        break;
                    }

                    // If we naturally hit the end of the logical statement tokens
                    if (this.evalPeek().type === TokenType.EOF) {
                        break;
                    }
                }

                if (!jumped) {
                    this.advanceToNextLine();
                }
            }
        } catch (err) {
            if (err && err.type === 'RUNTIME') {
                const source = this.programMemory[this.pc] || "";
                const lines = this.formatError(err, this.pc + " " + source);
                for (const line of lines) {
                    runtimePrintln(line);
                }
                return "";
            }
            if (err && err.type === 'SYNTAX') {
                const source = this.programMemory[this.pc] || "";
                const lines = this.formatError(err, this.pc + " " + source);
                for (const line of lines) {
                    runtimePrintln(line);
                }
                return "";
            }
            throw err;
        }

        return "";
    }

    isComment(token) {
        // Valid statement start tokens
        const validStarts = [
            TokenType.VARIABLE,    // A-Z, a-z
            TokenType.OP_NOT,      // #
            TokenType.BANG,        // !
            TokenType.AT,          // @
            TokenType.SEMICOLON,   // ;
            TokenType.QUESTION,    // ?
            TokenType.DQUESTION,   // ??
            TokenType.QDOLLAR,     // ?$
            TokenType.QZERO,      // ?0
            TokenType.DOLLAR,      // $
            TokenType.DOT,         // .
            TokenType.SLASH,       // /
            TokenType.STRING,      // "..."
            TokenType.RBRACKET,    // ]
        ];
        return !validStarts.includes(token.type);
    }

    skipOneStatement() {
        // Fast-forward past one statement without executing.
        // This is tricky because we need to know statement boundaries.
        // Statements end at the next statement-start token or EOF.
        // For now, we execute a simplified skip.
        const t = this.evalPeek();

        if (t.type === TokenType.STRING) {
            this.evalAdvance();
            return;
        }
        if (t.type === TokenType.SLASH) {
            this.evalAdvance();
            return;
        }
        if (t.type === TokenType.RBRACKET) {
            this.evalAdvance();
            return;
        }

        // For other statements, consume tokens until we hit another statement start
        // or EOF. Track bracket depth.
        this.evalAdvance();
        let depth = 0;
        let lastPos = this.evalPos;
        while (this.evalPeek().type !== TokenType.EOF) {
            const cur = this.evalPeek();
            if (cur.type === TokenType.LPAREN || cur.type === TokenType.LBRACKET ||
                cur.type === TokenType.LBRACE) {
                depth++;
                this.evalAdvance();
            } else if (cur.type === TokenType.RPAREN || cur.type === TokenType.RBRACKET ||
                cur.type === TokenType.RBRACE) {
                if (depth > 0) {
                    depth--;
                    this.evalAdvance();
                } else {
                    // ] at depth 0 could be RETURN — don't consume
                    if (cur.type === TokenType.RBRACKET) break;
                    this.evalAdvance();
                }
            } else if (depth === 0 && this.isStatementStart(cur)) {
                break;
            } else {
                this.evalAdvance();
            }
            // Saftey check to prevent infinite loops if advance fails to move forward
            if (this.evalPos === lastPos) break;
            lastPos = this.evalPos;
        }
    }

    isStatementStart(token) {
        // Check if this token could be the start of a new statement
        // Only at depth 0 and after we've consumed at least the first token
        const starts = [
            TokenType.VARIABLE,
            TokenType.OP_NOT,      // # (GOTO)
            TokenType.BANG,        // ! (GOSUB)
            TokenType.AT,          // @
            TokenType.SEMICOLON,   // ;
            TokenType.QUESTION,
            TokenType.DQUESTION,
            TokenType.QDOLLAR,
            TokenType.QZERO,
            TokenType.DOLLAR,
            TokenType.DOT,
            TokenType.SLASH,
            TokenType.STRING,
            TokenType.RBRACKET,    // ] (RETURN)
        ];
        return starts.includes(token.type);
    }

    advanceToNextLine() {
        const idx = this.sortedLines.indexOf(this.pc);
        if (idx === -1 || idx + 1 >= this.sortedLines.length) {
            this.running = false;
            return;
        }
        this.pc = this.sortedLines[idx + 1];
        this.stmtIndex = 0;
    }
}

// ======================== ENTRY POINT ========================

async function cosmosRun(programMemory, memory) {
    if (typeof window !== "undefined") window.cosmosInterruptFlag = false;
    const runtime = new CosmosRuntime(programMemory, memory);
    const result = await runtime.run();
    return result;
}

// ----- Direct Execution -----
async function cosmosExecuteDirect(lineStr, programMemory, memory) {
    if (typeof window !== "undefined") window.cosmosInterruptFlag = false;

    // Inject the direct command at line 0 (invalid line number for normal programs)
    programMemory[0] = lineStr;
    const runtime = new CosmosRuntime(programMemory, memory);

    // Override advanceToNextLine to handle stopping after the direct line
    const originalAdvance = runtime.advanceToNextLine.bind(runtime);
    runtime.advanceToNextLine = function () {
        if (this.pc === 0) {
            // Reached the end of the direct line without jumping
            this.running = false;
        } else {
            // Normal advance for lines > 0 (meaning we jumped into the real program)
            originalAdvance();
        }
    };

    try {
        // Run WITHOUT clearing memory (so variables persist between direct commands)
        const result = await runtime.run(false);
        return result;
    } finally {
        // Always clean up the injected line
        delete programMemory[0];
    }
}
