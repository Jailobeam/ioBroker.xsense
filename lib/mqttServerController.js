const { Aedes } = require('aedes');
const net = require('node:net');
let mqttServer;
let mqttBroker;

/**
 *
 */
class MqttServerController {
    /**
     *
     * @param adapter
     */
    constructor(adapter) {
        this.adapter = adapter;
    }

    /**
     *
     */
    async createMQTTServer() {
        try {
            const core = require('@iobroker/adapter-core');
            const Persistence = require('./mqttPersistence');
            const persistence = new Persistence({
                path: `${core.getAbsoluteInstanceDataDir(this.adapter)}/mqttData`,
                prefix: '',
            });
            const aedes = await Aedes.createBroker({persistence: persistence.asAsyncPersistence()});
            mqttBroker = aedes;
            mqttServer = net.createServer(aedes.handle);
            mqttServer.listen(this.adapter.config.mqttServerPort, this.adapter.config.mqttServerIPBind, () => {
                this.adapter.log.info(
                    `Starting MQTT-Server on IP ${this.adapter.config.mqttServerIPBind} and Port ${this.adapter.config.mqttServerPort}`,
                );
            });
        } catch (err) {
            this.adapter.log.error(err);
        }
    }

    /**
     *
     */
    closeServer() {
        if (mqttBroker && !mqttBroker.closed) {
            const broker = mqttBroker;
            broker.close(() => broker.persistence.destroy());
        }
        if (mqttServer && !mqttServer.closed) {
            mqttServer.close();
        }
    }
}

module.exports = {
    MqttServerController,
};
