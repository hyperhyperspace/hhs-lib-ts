import { TestSwarm } from '../mock/TestSwarm';
import { StateGossipAgent } from 'mesh/agents/state/StateGossipAgent';
import { SwarmControlAgent } from 'mesh/agents/swarm';
import { Hash } from 'data/model';
import { RNGImpl } from 'crypto/random';
import { LinearStateAgent } from '../mock/LinearStateAgent';
import { TestIdentity } from 'test/data/types/TestIdentity';
import { Store, IdbBackend } from 'data/storage';
import { MutableSet } from 'data/collections';
import { Identity } from 'data/identity';
import { TerminalOpsSyncAgent } from 'mesh/agents/state/TerminalOpsSyncAgent';

describe('State sync', () => {
    test('Gossip agent in small swarm', async (done) => {

        let topic = new RNGImpl().randomHexString(64);

        let swarms = TestSwarm.generate(topic, 3, 3, 2);

        const objCount = 3;
        const objIds   = new Array<Hash>();
        for (let i=0; i<objCount; i++) {
            objIds.push(new RNGImpl().randomHexString(32));
        }

        for (const swarm of swarms) {
            const swarmControl = swarm.getLocalAgent(SwarmControlAgent.agentIdForSwarm(topic)) as SwarmControlAgent;
            const gossip = new StateGossipAgent(topic, swarmControl);
            swarm.registerLocalAgent(gossip);
            for (let i=0; i<objCount; i++) {
                let agent = new LinearStateAgent(objIds[i], swarmControl);
                swarm.registerLocalAgent(agent);
            }
        }

        let seq0:Array<[number, string]> = [[0, 'zero'],[1,'one'], [2, 'two']];
        let seq1:Array<[number, string]> = [[10, 'a'], [10, 'b'], [3, 'three']]
        let seq2:Array<[number, string]> = [[11, 'eleven'], [10, 'ten'], [9, 'nine']];

        await new Promise(r => { window.setTimeout(() => { r() }, 1000);  });

        let seqs = [seq0, seq1, seq2];
        let witness: Array<LinearStateAgent> = [];
        let results: Array<[number, string]> = [[2, 'two'], [10, 'b'], [11, 'eleven']];

        for (let i=0; i<objCount; i++) {

            let objId = objIds[i];


            let seq = seqs[i];

            let c=0;
            for (let j=0; c<3; j++) {
                await new Promise(r => { window.setTimeout( r, 100); });
                let agent=swarms[j].getLocalAgent(LinearStateAgent.createId(objId)) as LinearStateAgent;
                if (agent !== undefined) {
                    if (c<3) {
                        seq
                        agent.setMessage(seq[c][1], seq[c][0]);
                    } else {
                        witness.push(agent);
                    }
                    c=c+1;
                }
            }

            let finished = false;
            let checks = 0;
            while (! finished && checks < 10) {
                
                await new Promise(r => { window.setTimeout( r, 50); });
    
                finished = true;
                for (let c=0; c<3 && finished; c++) {
    
                    if (witness.length <= c) continue;
    
                    finished = finished && witness[c].seq === results[c][0];
                    finished = finished && witness[c].message === results[c][1];
                }
                checks = checks + 1;
                
            }
    
            for (let c=0; c<3; c++) {
    
                if (witness.length <= c) continue;
    
                expect(witness[c].seq).toEqual(results[c][0]);
                expect(witness[c].message).toEqual(results[c][1])
            }
    
            //for (const swarm of swarms) {
            //    swarm.shutdown();
            //}
        }

        done();
    });

    test('Terminal ops agent-based set sync in small swarm', async (done) => {

        const size = 3;
        
        let swarmId = new RNGImpl().randomHexString(64);

        let swarms = TestSwarm.generate(swarmId, size, size, size-1);

        let stores : Array<Store> = [];
        
        for (let i=0; i<size; i++) {
            const swarmControl = swarms[i].getLocalAgent(SwarmControlAgent.agentIdForSwarm(swarmId)) as SwarmControlAgent;
            const store = new Store(new IdbBackend('store-for-peer-' + swarmControl.getLocalPeer().endpoint));
            stores.push(store);
            let gossip = new StateGossipAgent(swarmId, swarmControl);
            
            swarms[i].registerLocalAgent(gossip);
        }

        let id = TestIdentity.getFirstTestIdentity();
        let kp = TestIdentity.getFistTestKeyPair();
        
        let s = new MutableSet<Identity>();
        
        s.setAuthor(id);
        
        await stores[0].save(kp);
        await stores[0].save(s);

        for (let i=0; i<size; i++) {
            const swarmControl = swarms[i].getLocalAgent(SwarmControlAgent.agentIdForSwarm(swarmId)) as SwarmControlAgent;
            let agent = new TerminalOpsSyncAgent(swarmControl, s.hash(), stores[i], MutableSet.opClasses);
            //agent;
            swarms[i].registerLocalAgent(agent);
        }

        await s.add(id);
        
        await s.delete(id);
        
        await s.add(id);
        
        await s.delete(id);
        
        await s.add(id);
        //stores[size-1].save(sclone);

        //sclone.bindToStore();
        //sclone.loadAllOpsFromStore();

        //await stores[0].load(s.hash());

        await stores[0].save(s);

        //let ctx = s.toContext();

        //console.log(ctx.literals);

        //TestTopology.waitForPeers(swarms, size - 1);

        let replicated = false;

        let count = 0;

        while (!replicated && count < 200) {

            await new Promise(r => setTimeout(r, 50));

            const sr = await stores[size-1].load(s.hash()) as MutableSet<Identity> | undefined;

            if (sr !== undefined) {
                
                
                await sr.loadAllOpsFromStore();
                replicated = sr.size() === 1;
                //for (const elmt of sr.values()) {
                    //console.log('FOUND ELMT:');
                    //console.log(elmt);
                //}
            }

            count = count + 1;
        }

        expect(replicated).toBeTruthy();

        done();
    

    }, 20000);
});