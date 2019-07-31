// Adapted version of the speedometer npm package
// https://github.com/mafintosh/speedometer

const resolution = 4;
const interval = (1000 / resolution) | 0
const startTick = (Date.now() / interval).toFixed(0) - 1;
const maxTick = 65535;

function currentTick() {
    return ((Date.now() / interval).toFixed(0) - startTick) % maxTick;
}

module.exports = (seconds) => {
    let size = resolution * (seconds || 5);
    let buffer = [0];
    let pointer = 1;
    let last = (currentTick() - 1) & maxTick;

    return (delta) => {
        let dist = (currentTick() - last) & maxTick;

        if (dist > size) {
            dist = size;
        }

        last = currentTick();

        while (dist--) {
            if (pointer === size) {
                pointer = 0;
            }
            
            buffer[pointer] = buffer[pointer === 0 ? size - 1 : pointer - 1];
            pointer++;
        }

        if (delta) {
            buffer[pointer - 1] += delta;
        }

        let top = buffer[pointer - 1];
        let btm = buffer.length < size ? 0 : buffer[pointer === size ? 0 : pointer];

        return buffer.length < resolution ? top : (top - btm) * resolution / buffer.length;
    }
}
