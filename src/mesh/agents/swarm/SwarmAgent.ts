import { SwarmControlAgent } from './SwarmControlAgent';
import { Agent, AgentId } from '../../base/Agent';
import { Network, Event } from '../../base/Service';
import { Endpoint } from '../network/NetworkAgent';

import { Hash } from 'data/model';

abstract class SwarmAgent implements Agent {

    swarmControl: SwarmControlAgent;

    constructor(swarmControl: SwarmControlAgent) {
        this.swarmControl = swarmControl;
    }

    abstract getAgentId(): string;
    abstract ready(network: Network): void;

    receiveLocalEvent(ev: Event): void {
        ev;
    }
    
    getSwarmControl() {
        return this.swarmControl;
    }

    sendMessageToPeer(destination: Endpoint, agentId: AgentId, content: any) : boolean {
        return this.swarmControl.sendToPeer(destination, agentId, content);
    }

    abstract receivePeerMessage(source: Endpoint, sender: Hash, recipient: Hash, content: any) : void;

}

export { SwarmAgent }