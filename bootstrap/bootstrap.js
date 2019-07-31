const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

function getOptions(path) {
    let options = {
        method: 'GET',
        host: 'launcher.myftb.de',
        port: 443,
        path: path,
        protocol: 'https:',
        timeout: 90000,
        headers: {
            'User-Agent': 'MyFTB Launcher Bootstrapper'
        }
    };

    if (path.startsWith('http')) {
        Object.assign(options, url.parse(path));
    }

    return options;
}

function request(path, cb) {
    let req = https.request(getOptions(path), (res) => {
        let chunks = [];

        if (res.statusCode !== 200) {
            return cb('Ungültiger Statuscode für ' + path + ': ' + res.statusCode);
        }

        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => cb(false, Buffer.concat(chunks)));
    });

    req.on('error', err => cb(err));
    req.end();
}

function downloadFile(url, targetFile, speedometer, cb) {
    try {
        fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    } catch (err) {
        if (err.code !== 'EEXIST') {
            return cb(err);
        }
    }

    let req = https.request(getOptions(url), res => {
        if (res.statusCode !== 200) {
            return cb('Ungültiger Statuscode für ' + url + ': ' + res.statusCode);
        }

        let fileStream = fs.createWriteStream(targetFile);
        let hash = crypto.createHash('sha256');

        res.on('data', chunk => {
            hash.update(chunk);
            fileStream.write(chunk);
            speedometer(chunk.length);
        });

        res.on('end', () => {
            fileStream.end();
            return cb(false, hash.digest('hex'));
        });
    });

    req.on('error', err => cb(err));
    req.end();
}

function hashFile(file) {
    return new Promise((resolve, reject) => {
        fs.exists(file, exists => {
            if (!exists) {
                return resolve('');
            }

            fs.createReadStream(file)
                .on('error', reject)
                .pipe(crypto.createHash('sha256').setEncoding('hex'))
                .once('finish', function() { resolve(this.read()) });
        });
    });
}

function downloadFilePromise(basePath, obj, speedometer) {
    return (resolve, reject) => {
        let targetFile = path.join(basePath, obj.path);

        hashFile(targetFile)
            .then(hash => {
                if (hash === obj.hash) {
                    return resolve(targetFile);
                }

                downloadFile(obj.url, targetFile, speedometer, (err, hash) => {
                    if (err) {
                        return reject(err);
                    }

                    if (hash !== obj.hash) {
                        return reject('Ungültiger Dateihash von ' + targetFile + ': ' + hash);
                    }

                    return resolve(targetFile);
                });
            })
            .catch(err => reject(err));
    };
}

/**
 * Synchronisiert die Elemente eines Indizes.
 * @param {string} index Index-URL 
 * @param {string} basePath Grundverzeichnis
 * @param {function(length)} speedometer Speedometer zur Messung der Transferrate
 * @param {function(error, Promise)} cb Callback mit Fehler bzw. einem Promise für alle Aufgaben
 * @param {function(length)} progressCb Callback zur Fortschrittsanzeige
 */
function checkIndex(index, basePath, speedometer, cb, progressCb) {
    request(index, (err, data) => {
        if (err) {
            return cb(err);
        }

        let index = JSON.parse(data.toString());
        let proms = [];

        for (let obj of index.objects) {
            proms.push(new Promise((resolve, reject) => {
                let progress = progressCb(index.objects.length);
                let prom = downloadFilePromise(basePath, obj, speedometer);
                prom(arg => {
                    progress();
                    resolve(arg);
                }, arg => {
                    progress();
                    reject(arg);
                });
            }));
        }

        return cb(false, Promise.all(proms));
    });
}

module.exports = { checkIndex: checkIndex };