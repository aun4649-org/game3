const fs = require('fs');
global.window = { cosmosInterruptFlag: false };
eval(fs.readFileSync('./js/runtime.js', 'utf8'));

async function testUnclosed() {
    const mem = new Uint8Array(65536);
    const progMem = {
        10: '"WARAWA',
        20: '#=10'
    };

    global.runtimePrint = console.log;
    global.runtimePrintln = console.log;

    // Safety break
    let limit = 0;
    const oldEvalPeek = CosmosRuntime.prototype.evalPeek;
    CosmosRuntime.prototype.evalPeek = function () {
        limit++;
        if (limit > 500) {
            console.log("INFINITE LOOP CAUGHT IN EVAL PEEK");
            process.exit(1);
        }
        return oldEvalPeek.call(this);
    };

    try {
        console.log("Running direct: #=1");
        await cosmosExecuteDirect("#=1", progMem, mem);
        console.log("Finished execution");
    } catch (e) {
        console.error("Caught error:", e);
    }
}

testUnclosed();
