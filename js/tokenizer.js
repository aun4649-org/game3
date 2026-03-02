// ============================================================
// tokenizer.js — COSMOS II Lexical Analyser
// ============================================================
// Converts a single source line into a flat token array.
// Also exports the shared helpers toInt32 / toUint32.
// ============================================================

// ======================== HELPERS ============================

function toInt32(v)  { return v | 0; }
function toUint32(v) { return v >>> 0; }

// Fast hex-digit test used by the tokenizer.
function isHexChar(ch) {
    return (ch >= '0' && ch <= '9') ||
           (ch >= 'A' && ch <= 'F') ||
           (ch >= 'a' && ch <= 'f');
}

// ======================== TOKEN TYPES ========================

const TokenType = Object.freeze({
    NUMBER:     'NUMBER',
    VARIABLE:   'VARIABLE',
    SYSVAR_REM: 'SYSVAR_REM',   // %  (remainder system variable)
    SYSVAR_RND: 'SYSVAR_RND',   // '  (random system variable)
    OP_PLUS:    'OP_PLUS',
    OP_MINUS:   'OP_MINUS',
    OP_MUL:     'OP_MUL',
    OP_DIV:     'OP_DIV',
    OP_EQ:      'OP_EQ',        // ==
    OP_NE:      'OP_NE',        // <>
    OP_LT:      'OP_LT',        // <
    OP_GT:      'OP_GT',        // >
    OP_LE:      'OP_LE',        // <=
    OP_GE:      'OP_GE',        // >=
    OP_AND:     'OP_AND',       // &&
    OP_OR:      'OP_OR',        // ||
    OP_XOR:     'OP_XOR',       // ^
    OP_SHL:     'OP_SHL',       // <<
    OP_SHR:     'OP_SHR',       // >>
    OP_NOT:     'OP_NOT',       // # (logical not / GOTO)
    OP_BNOT:    'OP_BNOT',      // ## (bitwise not) — NOTE: ## is also the inline comment
                                //   marker, so this token is emitted only when ## appears
                                //   inside an already-open sub-expression context.
    ASSIGN:     'ASSIGN',       // =  (assignment)
    LPAREN:     'LPAREN',       // (
    RPAREN:     'RPAREN',       // )
    LBRACKET:   'LBRACKET',     // [
    RBRACKET:   'RBRACKET',     // ]
    LBRACE:     'LBRACE',       // {
    RBRACE:     'RBRACE',       // }
    COLON:      'COLON',        // :
    COMMA:      'COMMA',        // ,
    SEMICOLON:  'SEMICOLON',    // ;
    AT:         'AT',           // @
    BANG:       'BANG',         // !
    QUESTION:   'QUESTION',     // ?
    DOLLAR:     'DOLLAR',       // $
    DOT:        'DOT',          // .
    SLASH:      'SLASH',        // / (newline output)
    STRING:     'STRING',       // "..." string literal
    DQUESTION:  'DQUESTION',    // ??   (hex 4-digit output)
    QDOLLAR:    'QDOLLAR',      // ?$   (hex 2-digit output) / ?$(n)= (hex n-digit output)
    QZERO:      'QZERO',        // ?0   (zero-padded decimal output)
    DBLAT:      'DBLAT',        // @@   (clear variables)
    STMTSEP:    'STMTSEP',      // one-or-more spaces outside a string — statement separator
    EOF:        'EOF',
});

// ======================== TOKEN ==============================

class Token {
    constructor(type, value, pos) {
        this.type  = type;
        this.value = value;
        this.pos   = pos;   // character offset in the source line
    }
}

// Reusable sentinel returned by evalPeek() when past end-of-tokens.
// Using a singleton avoids repeated allocation in the hot evaluation path.
const EOF_TOKEN = Object.freeze(new Token(TokenType.EOF, null, -1));

// ======================== TOKENIZER ==========================

// Lookup table: single-char → TokenType.  Checked last so multi-char
// operators (`==`, `<<`, `&&`, …) are already handled before reaching here.
const SINGLE_CHAR_TOKENS = Object.freeze({
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
});

class Tokenizer {
    constructor(source) {
        this.src = source;
    }

    // Returns a flat Token array for the given source line.
    // Performance notes:
    //   - All state is kept in local variables (avoids property-lookup overhead).
    //   - String slices (src.slice) replace character-by-character concatenation.
    //   - No helper method calls inside the hot loop.
    tokenize() {
        const src    = this.src;
        const len    = src.length;
        const tokens = [];
        let   pos    = 0;

        while (pos < len) {
            const startPos = pos;
            const ch = src[pos];

            // ---- Inline comments: //, ##, -- ----
            if (pos + 1 < len) {
                const nx = src[pos + 1];
                if ((ch === '/' && nx === '/') ||
                    (ch === '#' && nx === '#') ||
                    (ch === '-' && nx === '-')) {
                    break; // rest of line is a comment
                }
            }

            // ---- Whitespace: one or more spaces → statement separator ----
            // Spaces inside a string literal are already consumed above.
            // Any space outside a string marks a boundary between statements.
            // Consecutive spaces are coalesced into a single STMTSEP token.
            if (ch === ' ') {
                while (pos < len && src[pos] === ' ') pos++;
                tokens.push(new Token(TokenType.STMTSEP, ' ', startPos));
                continue;
            }

            // ---- String literal "..." ----
            if (ch === '"') {
                pos++; // skip opening "
                const strStart = pos;
                while (pos < len && src[pos] !== '"') pos++;
                tokens.push(new Token(TokenType.STRING, src.slice(strStart, pos), startPos));
                if (pos < len) pos++; // skip closing "
                continue;
            }

            // ---- Decimal integer ----
            if (ch >= '0' && ch <= '9') {
                const numStart = pos;
                while (pos < len && src[pos] >= '0' && src[pos] <= '9') pos++;
                tokens.push(new Token(TokenType.NUMBER,
                    parseInt(src.slice(numStart, pos), 10), startPos));
                continue;
            }

            // ---- $ — hex literal ($HHHH) or DOLLAR ----
            if (ch === '$') {
                const nx = (pos + 1 < len) ? src[pos + 1] : '';
                if (isHexChar(nx)) {
                    pos++; // skip $
                    const hexStart = pos;
                    while (pos < len && isHexChar(src[pos])) pos++;
                    let val = parseInt(src.slice(hexStart, pos), 16);
                    if (val > 0x7FFFFFFF) val -= 0x100000000; // two's complement
                    tokens.push(new Token(TokenType.NUMBER, val | 0, startPos));
                } else {
                    pos++;
                    tokens.push(new Token(TokenType.DOLLAR, '$', startPos));
                }
                continue;
            }

            // ---- % — binary literal (%0101) or SYSVAR_REM ----
            if (ch === '%') {
                const nx = (pos + 1 < len) ? src[pos + 1] : '';
                if (nx === '0' || nx === '1') {
                    pos++; // skip %
                    const binStart = pos;
                    while (pos < len && (src[pos] === '0' || src[pos] === '1')) pos++;
                    const binStr = src.slice(binStart, pos);
                    let val = parseInt(binStr, 2);
                    if (binStr.length === 32 && binStr[0] === '1') val -= 0x100000000;
                    tokens.push(new Token(TokenType.NUMBER, val | 0, startPos));
                } else {
                    pos++;
                    tokens.push(new Token(TokenType.SYSVAR_REM, '%', startPos));
                }
                continue;
            }

            // ---- ' — SYSVAR_RND ----
            if (ch === "'") {
                pos++;
                tokens.push(new Token(TokenType.SYSVAR_RND, "'", startPos));
                continue;
            }

            // ---- Variable (A-Z, a-z) — first char is the name, rest are skipped ----
            if ((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z')) {
                pos++;
                while (pos < len &&
                       ((src[pos] >= 'A' && src[pos] <= 'Z') ||
                        (src[pos] >= 'a' && src[pos] <= 'z'))) pos++;
                tokens.push(new Token(TokenType.VARIABLE, ch, startPos));
                continue;
            }

            // ---- Two-character operators ----

            // ==
            if (ch === '=' && pos + 1 < len && src[pos + 1] === '=') {
                tokens.push(new Token(TokenType.OP_EQ, '==', startPos));
                pos += 2; continue;
            }
            // < <= <> <<
            if (ch === '<') {
                pos++;
                if (pos < len && src[pos] === '>') {
                    pos++; tokens.push(new Token(TokenType.OP_NE,  '<>', startPos));
                } else if (pos < len && src[pos] === '=') {
                    pos++; tokens.push(new Token(TokenType.OP_LE, '<=', startPos));
                } else if (pos < len && src[pos] === '<') {
                    pos++; tokens.push(new Token(TokenType.OP_SHL, '<<', startPos));
                } else {
                    tokens.push(new Token(TokenType.OP_LT, '<', startPos));
                }
                continue;
            }
            // > >= >>
            if (ch === '>') {
                pos++;
                if (pos < len && src[pos] === '=') {
                    pos++; tokens.push(new Token(TokenType.OP_GE,  '>=', startPos));
                } else if (pos < len && src[pos] === '>') {
                    pos++; tokens.push(new Token(TokenType.OP_SHR, '>>', startPos));
                } else {
                    tokens.push(new Token(TokenType.OP_GT, '>', startPos));
                }
                continue;
            }
            // &&
            if (ch === '&' && pos + 1 < len && src[pos + 1] === '&') {
                tokens.push(new Token(TokenType.OP_AND, '&&', startPos));
                pos += 2; continue;
            }
            // ||
            if (ch === '|' && pos + 1 < len && src[pos + 1] === '|') {
                tokens.push(new Token(TokenType.OP_OR, '||', startPos));
                pos += 2; continue;
            }
            // # — OP_NOT  (## was already caught as a comment above)
            if (ch === '#') {
                pos++;
                tokens.push(new Token(TokenType.OP_NOT, '#', startPos));
                continue;
            }
            // ? ?? ?$ ?0
            if (ch === '?') {
                pos++;
                if (pos < len && src[pos] === '?') {
                    pos++; tokens.push(new Token(TokenType.DQUESTION, '??', startPos));
                } else if (pos < len && src[pos] === '$') {
                    pos++; tokens.push(new Token(TokenType.QDOLLAR,   '?$', startPos));
                } else if (pos < len && src[pos] === '0') {
                    pos++; tokens.push(new Token(TokenType.QZERO,     '?0', startPos));
                } else {
                    tokens.push(new Token(TokenType.QUESTION, '?', startPos));
                }
                continue;
            }
            // @@ — clear variables
            if (ch === '@' && pos + 1 < len && src[pos + 1] === '@') {
                tokens.push(new Token(TokenType.DBLAT, '@@', startPos));
                pos += 2; continue;
            }

            // ---- Single-character tokens ----
            const type = SINGLE_CHAR_TOKENS[ch];
            if (type !== undefined) {
                pos++;
                tokens.push(new Token(type, ch, startPos));
                continue;
            }

            // ---- Unknown character — skip silently ----
            pos++;
            tokens.push(new Token('UNKNOWN', ch, startPos));
        }

        tokens.push(new Token(TokenType.EOF, null, pos));
        return tokens;
    }
}
