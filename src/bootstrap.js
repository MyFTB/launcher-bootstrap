const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const url = require('url');
const logging = require('./logging');
const { app, net } = require('electron');

function createRequest(path) {
    let options = {
        method: 'GET',
        protocol: 'https:',
        port: 443,
        host: 'launcher.myftb.de',
        path,
    }

    if (path.startsWith('http')) {
        Object.assign(options, url.parse(path));
    }

    let request = net.request(options);

    request.setHeader('User-Agent', 'MyFTB Launcher Bootstrapper ' + app.getVersion());

    return request;
}

function request(path, cb) {
    let req = createRequest(path);
    req.on('error', err => cb(err));
    
    let chunks = [];
    req.on('response', (res) => {
        if (res.statusCode !== 200) {
            return cb('Ungültiger Statuscode für ' + path + ': ' + res.statusCode);
        }

        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => cb(false, Buffer.concat(chunks)));
    });

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

    let req = createRequest(url);
    req.on('error', err => cb(err));

    req.on('response', (res) => {
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
            fileStream.end(() => fs.chmodSync(targetFile, 0o755));
            return cb(false, hash.digest('hex'));
        });
    });

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
 * @param {string} indexPath Index-URL 
 * @param {string} basePath Grundverzeichnis
 * @param {function(length)} speedometer Speedometer zur Messung der Transferrate
 * @param {function(error, Promise)} cb Callback mit Fehler bzw. einem Promise für alle Aufgaben
 * @param {function(length)} progressCb Callback zur Fortschrittsanzeige
 */
function checkIndex(indexPath, basePath, speedometer, cb, progressCb) {
    logging.log('INFO', 'Überprüfe Index ' + indexPath + ' mit Grundverzeichnis ' + basePath);
    request(indexPath, (err, data) => {
        if (err) {
            return cb(err);
        }

        let index = JSON.parse(data.toString());
        let proms = [];
        logging.log('INFO', 'Index ' + indexPath + ' hat ' + index.objects.length + ' Objekte');

        for (let obj of index.objects) {
            proms.push(new Promise((resolve, reject) => {
                let progress = progressCb(index.objects.length);
                let prom = downloadFilePromise(basePath, obj, speedometer);
                logging.log('INFO', 'Überprüfe Objekt ' + JSON.stringify(obj));
                prom(arg => {
                    progress();
                    resolve(arg);
                    logging.log('INFO', obj.path + ' erfolgreich überprüft und vollständig (1/3)');
                }, arg => {
                    logging.log('ERROR', 'Fehler beim Herunterladen von ' + obj.path + ' (1/3): ' + arg);
                    prom(arg => {
                        progress();
                        resolve(arg);
                        logging.log('INFO', obj.path + ' erfolgreich überprüft und vollständig (2/3)');
                    }, arg => {
                        logging.log('ERROR', 'Fehler beim Herunterladen von ' + obj.path + ' (2/3): ' + arg);
                        prom(arg => {
                            progress();
                            resolve(arg);
                            logging.log('INFO', obj.path + ' erfolgreich überprüft und vollständig (3/3)');
                        }, arg => {
                            progress();
                            reject(arg);
                            logging.log('ERROR', 'Fehler beim Herunterladen von ' + obj.path + ' (3/3): ' + arg);
                        });
                    });
                });
            }));
        }

        return cb(false, Promise.all(proms));
    });
}

module.exports = { checkIndex };