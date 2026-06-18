'use strict';

const assert = require('node:assert/strict');
const {once} = require('node:events');
const {mkdtemp, rm, writeFile} = require('node:fs/promises');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const {promisify} = require('node:util');
const Persistence = require('../lib/mqttPersistence');

describe('MQTT persistence on Node.js 24', () => {
    let directory;
    let persistence;

    beforeEach(async () => {
        directory = await mkdtemp(join(tmpdir(), 'xsense-mqtt-'));
    });

    afterEach(async () => {
        if (persistence) {
            persistence.destroy();
            persistence = null;
        }
        await rm(directory, {recursive: true, force: true});
    });

    async function open() {
        persistence = new Persistence({path: directory});
        await once(persistence, 'ready');
    }

    async function retained() {
        const packets = [];
        for await (const packet of persistence.createRetainedStream('xsense/#')) {
            packets.push(packet);
        }
        return packets;
    }

    it('stores retained payloads and subscriptions across a restart', async () => {
        await open();
        await promisify(persistence.storeRetained).call(persistence, {
            topic: 'xsense/example', payload: Buffer.from('online'), qos: 1,
        });
        await promisify(persistence.addSubscriptions).call(persistence, {id: 'example-client'}, [
            {topic: 'xsense/#', qos: 1},
        ]);
        persistence.destroy();
        persistence = null;
        await open();
        const packets = await retained();
        assert.equal(packets.length, 1);
        assert.equal(packets[0].payload.toString(), 'online');
        const subscriptions = await promisify(persistence.subscriptionsByClient)
            .call(persistence, {id: 'example-client'});
        assert.equal(subscriptions[0].topic, 'xsense/#');
        await promisify(persistence.storeRetained).call(persistence, {
            topic: 'xsense/example', payload: Buffer.alloc(0),
        });
        assert.deepEqual(await retained(), []);
    });

    it('reads existing NeDB retained database records', async () => {
        const record = {
            _id: 'example-record', topic: 'xsense/legacy',
            payload: {type: 'Buffer', data: [111, 107]}, qos: 0,
        };
        await writeFile(join(directory, 'retained.db'), `${JSON.stringify(record)}\n`);
        await open();
        const packets = await retained();
        assert.equal(packets[0].payload.toString(), 'ok');
    });

    it('serves retained messages through a real MQTT broker', async () => {
        await open();
        const {Aedes} = require('aedes');
        const broker = await Aedes.createBroker({persistence: persistence.asAsyncPersistence()});
        const server = require('node:net').createServer(broker.handle);
        const clients = [];
        try {
            server.listen(0, '127.0.0.1');
            await once(server, 'listening');
            const url = `mqtt://127.0.0.1:${server.address().port}`;
            const publisher = require('mqtt').connect(url, {reconnectPeriod: 0});
            clients.push(publisher);
            await once(publisher, 'connect');
            await publisher.publishAsync('xsense/live', 'online', {qos: 1, retain: true});
            const subscriber = require('mqtt').connect(url, {reconnectPeriod: 0});
            clients.push(subscriber);
            await once(subscriber, 'connect');
            const received = once(subscriber, 'message');
            await subscriber.subscribeAsync('xsense/#');
            const [topic, payload, packet] = await received;
            assert.equal(topic, 'xsense/live');
            assert.equal(payload.toString(), 'online');
            assert.equal(packet.retain, true);
        } finally {
            for (const client of clients) {
                await client.endAsync(true);
            }
            await promisify(broker.close).call(broker);
            persistence.destroy();
            persistence = null;
            await promisify(server.close).call(server);
        }
    });
});
