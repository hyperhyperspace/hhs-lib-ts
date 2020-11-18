import { parentPort } from 'worker_threads';
import { VDF } from './VDF';

class VDFWorker {
    static start() {
    
            parentPort?.on('message', async (q: {challenge: string, steps: number}) => {
    
    
                console.log('worker woke up')
    
                let result = await VDF.compute(q.challenge, q.steps);
    
                console.log('worker has worked')

                if (parentPort !== undefined && parentPort !== null) {
                    parentPort.postMessage(
                        { 
                            challenge: q.challenge,
                            steps: q.steps,
                            result: result
                        }
                    );

                    console.log('worker has answered')
                }

                
            });
    }
}

VDFWorker.start();
