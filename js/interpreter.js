// Interpreter state (Program Memory)
const programMemory = {};

function processCommand(line) {
    line = line.trim();
    if (line === "") return; // Empty lines do nothing

    // Check if line starts with a number (Line number entry for memory)
    const lineNumMatch = line.match(/^(\d+)(.*)$/);
    if (lineNumMatch) {
        const lineNo = parseInt(lineNumMatch[1], 10);
        const code = lineNumMatch[2].trim();

        if (code === "") {
            // If code is empty, delete the line
            delete programMemory[lineNo];
        } else {
            // Save or Update memory
            programMemory[lineNo] = code;
        }
        // No output message for memory edits, just silent return like classic BASIC
        return;
    }

    // It's a direct command
    const parts = line.split(" ");
    const cmd = parts[0].toUpperCase();

    switch (cmd) {
        case "LIST": {
            let start = 0, end = Infinity;
            if (parts[1]) {
                let p = parts[1].split('-');
                let s = p[0] ? parseInt(p[0], 10) : 0;
                let e = p.length > 1 ? (p[1] ? parseInt(p[1], 10) : Infinity) : s;
                if (!isNaN(s)) start = s;
                if (!isNaN(e)) end = e;
            }
            const lines = Object.keys(programMemory).map(Number).sort((a, b) => a - b);
            const output = [];
            for (let num of lines) {
                if (num >= start && num <= end) {
                    output.push(num + " " + programMemory[num]);
                }
            }
            return output;
        }

        case "DELETE": {
            if (!parts[1]) {
                return "SYNTAX ERROR";
            }
            let start = 0, end = Infinity;
            let p = parts[1].split('-');
            let s = p[0] ? parseInt(p[0], 10) : 0;
            let e = p.length > 1 ? (p[1] ? parseInt(p[1], 10) : Infinity) : s;
            if (!isNaN(s)) start = s;
            if (!isNaN(e)) end = e;

            const lines = Object.keys(programMemory).map(Number);
            let deleted = false;
            for (let num of lines) {
                if (num >= start && num <= end) {
                    delete programMemory[num];
                    deleted = true;
                }
            }
            if (deleted) return "OK";
            else return "LINE NOT FOUND";
        }

        case "NEW":
            for (let key in programMemory) {
                delete programMemory[key];
            }
            return "OK";

        case "RUN":
            return "RUN IS NOT IMPLEMENTED YET. BUT WOW!";

        case "CLEAR":
        case "CLS":
            clearScreen();
            return; // Return undefined so no extra output is printed

        case "FONT": {
            let size = parseInt(parts[1], 10);
            if (!isNaN(size) && size > 5 && size < 100) {
                document.getElementById('screen').style.fontSize = size + "px";
                return "OK";
            } else {
                return "SYNTAX ERROR";
            }
        }

        case "HELP":
            return [
                "GAME III COMMANDS:",
                "  LIST [start]-[end]  : SHOW PROGRAM LINES",
                "  DELETE [start]-[end]: DELETE PROGRAM LINES",
                "  NEW                 : CLEAR PROGRAM",
                "  RUN                 : EXECUTE PROGRAM",
                "  FONT <size>         : CHANGE FONT SIZE",
                "  CLEAR / CLS         : CLEAR SCREEN",
                "  HELP                : SHOW THIS MESSAGE"
            ];

        default:
            return "SYNTAX ERROR";
    }
}
