import { HashedObject, LiteralContext } from './HashedObject';
import { MutationOp } from './MutationOp';
import { Hash } from './Hashing';
import { TerminalOpsSyncAgent } from 'data/sync/TerminalOpsSyncAgent';
import { HashReference } from './HashReference';

abstract class MutableObject extends HashedObject {

    readonly _acceptedMutationOpClasses : Array<string>;
    _unsavedOps  : Array<MutationOp>;
    _terminalOps : Map<Hash, HashReference>;

    _opCallback : (hash: Hash) => void;


    constructor(acceptedOpClasses : Array<string>) {
        super();
        
        this._acceptedMutationOpClasses = acceptedOpClasses;
        this._unsavedOps  = [];
        this._terminalOps = new Map();

        this._opCallback = (hash: Hash) => {
            this.applyOpFromStore(hash);
        };
    }

    abstract async mutate(op: MutationOp): Promise<boolean>;

    async loadAllOpsFromStore(batchSize?: number) {
        if (batchSize === undefined) {
            batchSize = 50;
        }

        let results = await this.getStore()
                                .loadByReference(
                                    'target', 
                                    this.getStoredHash(), 
                                    {
                                        order: 'asc',
                                        limit: batchSize
                                    });

        while (results.objects.length > 0) {

            for (const obj of results.objects) {
                const op = obj as MutationOp;
                await this.apply(op);
                for (const ref of op.getPrevOps()) {
                    this._terminalOps.delete(ref.hash);
                }
                this._terminalOps.set(op.getStoredHash(), op.createReference());
            }

            results = await this.getStore()
                                .loadByReference(
                                    'target', 
                                    this.getStoredHash(), 
                                    {
                                        order: 'asc',
                                        limit: batchSize,
                                        start: results.end
                                    });
        }
    }

    async loadLastOpsFromStore(count: number, start?: string) {

        let lastOp: Hash | undefined = undefined;

        if (start === undefined) {
            let terminalOpInfo = await this.getStore().loadTerminalOpsForMutable(this.getStoredHash());

            this._terminalOps = new Map();

            if (terminalOpInfo !== undefined) {
                lastOp = terminalOpInfo.lastOp;
                for (const terminalOpHash of terminalOpInfo.terminalOps) {
                    let terminalOp = await this.getStore().load(terminalOpHash) as HashedObject;
                    this._terminalOps.set(terminalOpHash, terminalOp.createReference());
                }
            }
        }

        let params: any = { order: 'desc', limit: count };
        
        if (start !== undefined) { params.start = start };

        let results = await this.getStore()
                                .loadByReference(
                                    'target', 
                                    this.getStoredHash(), 
                                    params);
        
        for (const obj of results.objects) {
            let op = obj as MutationOp;

            if (lastOp !== undefined) {
                if (lastOp === op.getStoredHash()) {
                    lastOp === undefined;
                }
            }

            if (lastOp === undefined && this.shouldAcceptMutationOp(op)) {
                this.apply(op);
            }
        }

    }


    async applyOpFromStore(hash: Hash) {
        let op: MutationOp;

        op = await this.getStore().load(hash, this.getAliasingContext()) as MutationOp;
        
        await this.apply(op);
    }

    async applyNewOp(op: MutationOp) : Promise<void> {

        if (this.shouldAcceptMutationOp(op)) {
            throw new Error ('Invalid op ' + op.hash() + 'attempted for ' + this.hash());
        } else {
            await this.apply(op);
            this.enqueueOpToSave(op);
        }
    }

    protected async apply(op: MutationOp) : Promise<void> {
        await this.mutate(op);
    }

    nextOpToSave() : MutationOp | undefined {
        if (this._unsavedOps.length > 0) {
            return this._unsavedOps.shift();
        } else {
            return undefined;
        }
    }

    failedToSaveOp(op: MutationOp) : void {
        this._unsavedOps.unshift(op);
    }

    protected enqueueOpToSave(op: MutationOp) : void {
        this._unsavedOps.push(op);
    }

    literalizeInContext(context: LiteralContext, path: string, flags?: Array<string>) : Hash {

        if (flags === undefined) {
            flags = [];
        }

        flags.push('mutable');

        return super.literalizeInContext(context, path, flags);

    }

    autoLoadFromStore(value: boolean) {
        if (value) {
            this.getStore().watchReferences('target', this.getStoredHash(), this._opCallback);
        } else {
            this.getStore().removeReferencesWatch('target', this.getStoredHash(), this._opCallback);
        }
    }

    shouldAcceptMutationOp(op: MutationOp) {
        return this._acceptedMutationOpClasses.indexOf(op.getClassName()) >= 0;
    }

    getSyncAgent() {
        return new TerminalOpsSyncAgent(this.getStoredHash(), this.getStore(), this._acceptedMutationOpClasses);
    }

}

export { MutableObject }