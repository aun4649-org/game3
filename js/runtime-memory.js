// ============================================================
// runtime-memory.js — Memory access and variable helpers
// ============================================================
// Adds byte / word / dword read-write methods to CosmosRuntime,
// plus the variable address resolver.
// All addresses are unsigned 16-bit; values are signed 32-bit.
// ============================================================

// ---------- System Variable: % (remainder) ------------------
// Stored at $00D0-$00D3 (big-endian dword) so it persists across
// direct-mode executions that share the same memory buffer.

Object.defineProperty(CosmosRuntime.prototype, 'systemVarRemainder', {
    get()  { return this.memReadDwordAddr(0x00D0); },
    set(v) { this.memWriteDwordAddr(0x00D0, v); },
    configurable: true,
});

Object.assign(CosmosRuntime.prototype, {

    // ---------- Byte ----------------------------------------

    memReadByte(addr) {
        addr = toUint32(addr);
        if (addr > 0xFFFF) throw this.runtimeError("Address out of range");
        return this.memory[addr];
    },

    memWriteByte(addr, value) {
        addr = toUint32(addr);
        if (addr > 0xFFFF) throw this.runtimeError("Address out of range");
        this.memory[addr] = value & 0xFF;
    },

    // ---------- Word (signed 16-bit, big-endian) ------------

    memReadWordAddr(addr) {
        addr = toUint32(addr);
        if (addr + 1 > 0xFFFF) throw this.runtimeError("Address out of range");
        const u = (this.memory[addr] << 8) | this.memory[addr + 1];
        return (u << 16) >> 16; // sign-extend to 32-bit
    },

    memWriteWordAddr(addr, value) {
        addr = toUint32(addr);
        if (addr + 1 > 0xFFFF) throw this.runtimeError("Address out of range");
        const v = value & 0xFFFF;
        this.memory[addr]     = (v >> 8) & 0xFF;
        this.memory[addr + 1] =  v       & 0xFF;
    },

    // ---------- Dword (signed 32-bit, big-endian) -----------

    memReadDwordAddr(addr) {
        addr = toUint32(addr);
        if (addr + 3 > 0xFFFF) throw this.runtimeError("Address out of range");
        const u = (this.memory[addr]     << 24) | (this.memory[addr + 1] << 16) |
                  (this.memory[addr + 2] <<  8) |  this.memory[addr + 3];
        return u | 0; // convert to signed int32
    },

    memWriteDwordAddr(addr, value) {
        addr = toUint32(addr);
        if (addr + 3 > 0xFFFF) throw this.runtimeError("Address out of range");
        const v = value | 0;
        this.memory[addr]     = (v >>> 24) & 0xFF;
        this.memory[addr + 1] = (v >>> 16) & 0xFF;
        this.memory[addr + 2] = (v >>>  8) & 0xFF;
        this.memory[addr + 3] =  v         & 0xFF;
    },

    // ---------- Variable access -----------------------------
    // A-Z → $0000-$0064 (4 bytes each)
    // a-z → $0068-$00CC (4 bytes each)

    getVarAddr(name) {
        const ch = name.charCodeAt(0);
        if (ch >= 65 && ch <= 90)  return (ch - 65) * 4;
        if (ch >= 97 && ch <= 122) return 0x0068 + (ch - 97) * 4;
        return -1;
    },

    getVar(name) {
        const addr = this.getVarAddr(name);
        return addr < 0 ? 0 : this.memReadDwordAddr(addr);
    },

    setVar(name, value) {
        const addr = this.getVarAddr(name);
        if (addr >= 0) this.memWriteDwordAddr(addr, value);
    },

});
