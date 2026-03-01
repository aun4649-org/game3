const fs = require('fs');
global.window = { cosmosInterruptFlag: false };
eval(fs.readFileSync('./js/runtime.js', 'utf8'));

async function test1() {
    const mem = new Uint8Array(65536);
    const progMem = {
        10: '"WARAWA "',
        20: '#=10'
    };

    let printCount = 0;
    global.runtimePrint = (s) => {
        if (printCount < 5) {
            console.log("PRINT:", s);
        }
        printCount++;
        if (printCount > 5) {
            // Simulate interrupt
            global.window.cosmosInterruptFlag = true;
        }
    };
    global.runtimePrintln = (s) => {
        if (printCount < 5) {
            console.log("PRINTLN:", s);
        }
    };

    try {
        console.log("Running direct: #=1");
        await cosmosExecuteDirect("#=1", progMem, mem);
        console.log("Finished direct execution");
    } catch (e) {
        console.error("Caught error:", e);
    }
}

test1();
