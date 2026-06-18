'use strict';

const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');

// Load the real adapter handler with inert dependencies, without starting ioBroker.
function loadHandler() {
    const source = readFileSync(join(__dirname, '../main.js'), 'utf8');
    const context = {
        module: {parent: {}, exports: {}},
        require: () => ({}),
        global: {},
    };
    vm.runInNewContext(`${source}\nmodule.exports = XSenseAdapter.prototype.testAlarm;
        mqttClient = {closed: false, connected: true};`, {
        ...context,
        require: name => name === '@iobroker/adapter-core' ? {Adapter: class {}} : {},
    });
    return context.module.exports;
}

describe('test alarm transport', () => {
    const stateId = 'xsense.0.devices.Example_Home.BRIDGE001.DEV001.test_Alarm';

    for (const fail of [false, true]) {
        it(`uses the cloud with local MQTT connected and resets the button (${fail ? 'failure' : 'success'})`, async () => {
            const handler = loadHandler();
            const calls = [];
            const messages = [];
            const states = [];
            const adapter = {
                log: {debug() {}, error() {}},
                xsenseClient: {
                    async testAlarm(serial) {
                        calls.push(serial);
                        if (fail) {
                            throw new Error('Cloud unavailable');
                        }
                        return 'Request sent';
                    },
                },
                // These methods made the previous handler take the local MQTT shortcut.
                findStationByDeviceSerial: () => ({serial: 'BRIDGE001'}),
                findDeviceBySerial: () => ({serial: 'DEV001'}),
                publishShadowUpdate: () => assert.fail('Test alarms must not use the local MQTT broker'),
                setActionMessage: (_id, message) => messages.push(message),
                setState: (id, state) => states.push({id, ...state}),
            };
            adapter.xsenseClient.buildActionRequest = () => ({topic: '2nd_selftest_DEV001', desired: {}});
            await handler.call(adapter, stateId);
            assert.deepEqual(calls, ['DEV001']);
            assert.equal(messages.at(-1), fail ? 'Fehler: Cloud unavailable' : 'Request sent');
            assert.deepEqual(states, [{id: stateId, val: false, ack: true}]);
        });
    }
});
