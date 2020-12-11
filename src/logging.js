const fs = require('fs');

let stream;

function init(logFile) {
    if (fs.existsSync(logFile)) {
        fs.unlinkSync(logFile);
    }

    stream = fs.createWriteStream(logFile);
}

function log(level, message) {
    let finalMsg = '[' + level + '] ' + message;
    if (stream) {
        stream.write(finalMsg + '\n');
    }
    console.log(finalMsg);
}

module.exports = {init: init, log: log};