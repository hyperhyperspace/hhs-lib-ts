import { Logger, LogLevel } from 'util/logging';

import { LinkupAddress } from './LinkupAddress';

type NewCallMessageCallback = (sender: LinkupAddress, callId: string, message: any) => void;
type MessageCallback    = (message: any) => void;

class LinkupServerConnection {

    readonly serverURL : string;

    static logger = new Logger(LinkupServerConnection.name, LogLevel.INFO);

    ws : WebSocket | null;

    newCallMessageCallbacks : Map<string, Set<NewCallMessageCallback>>;
    messageCallbacks        : Map<string, Map<string, Set<MessageCallback>>>;

    linkupIdsToListen : Set<string>;

    messageQueue     : string[];

    constructor(serverURL : string) {
        this.serverURL = serverURL;

        this.ws = null;

        this.newCallMessageCallbacks    = new Map();
        this.messageCallbacks = new Map();

        this.linkupIdsToListen = new Set();

        this.messageQueue = [];

        this.checkWebsocket();
    }
    
    listenForMessagesNewCall(recipient: LinkupAddress, callback: NewCallMessageCallback) : void {

        if (recipient.serverURL !== this.serverURL) {
            let e = new Error('Trying to listen for calls to ' + 
                              recipient.serverURL + 
                              ' but this is a connection to ' +
                              this.serverURL);
            LinkupServerConnection.logger.error(e);
            throw e;
        }

        let recipientCallCallbacks = this.newCallMessageCallbacks.get(recipient.linkupId);

        if (recipientCallCallbacks === undefined) {
            recipientCallCallbacks = new Set();
            this.newCallMessageCallbacks.set(recipient.linkupId, recipientCallCallbacks);
        }

        recipientCallCallbacks.add(callback);

        this.setUpListenerIfNew(recipient.linkupId);
    }

    listenForMessagesOnCall(recipient: LinkupAddress, callId: string, callback: MessageCallback) {

        if (recipient.serverURL !== this.serverURL) {
            let e = new Error('Trying to listen for messages to ' + 
                              recipient.serverURL + 
                              ' but this is a connection to ' +
                              this.serverURL);
            LinkupServerConnection.logger.error(e);
            throw e;
        }

        let linkupIdCalls = this.messageCallbacks.get(recipient.linkupId);

        if (linkupIdCalls === undefined) {
            linkupIdCalls = new Map();
            this.messageCallbacks.set(recipient.linkupId, linkupIdCalls);
        }

        let messageCallbacks = linkupIdCalls.get(callId);

        if (messageCallbacks === undefined) {
            messageCallbacks = new Set();
            linkupIdCalls.set(callId, messageCallbacks);
        }

        messageCallbacks.add(callback);

        this.setUpListenerIfNew(recipient.linkupId);
    }

    sendMessage(sender: LinkupAddress, recipient: LinkupAddress, callId: string, data: any) {

        if (recipient.serverURL !== this.serverURL) {
            let e = new Error('Trying to send a linkup message to ' + 
                              recipient.serverURL + 
                              ' but this is a connection to ' +
                              this.serverURL);
            LinkupServerConnection.logger.error(e);
            throw e;
        }

        var message = {
                    'action':   'send',
                    'linkupId': recipient.linkupId,
                    'callId':   callId,
                    'data':     data,
                    'replyServerUrl': sender.serverURL,
                    'replyLinkupId':  sender.linkupId,
                  };
        
        this.enqueueAndSend(JSON.stringify(message));
    }

    private checkWebsocket() : boolean {
        if (this.ws !== null && this.ws.readyState === WebSocket.OPEN) {
            return true;
        } else {
            if (this.ws === null ||
                (this.ws.readyState === WebSocket.CLOSING ||
                 this.ws.readyState === WebSocket.CLOSED)) {
                
                LinkupServerConnection.logger.debug('creating websocket to server ' + this.serverURL);
                this.ws = new WebSocket(this.serverURL);
      
                this.ws.onmessage = (ev) => {
                    const message = JSON.parse(ev.data);
                    const ws = this.ws as WebSocket;
        
                    if (message['action'] === 'ping') {
                        LinkupServerConnection.logger.trace('sending pong to ' + this.serverURL);
                        ws.send(JSON.stringify({'action' : 'pong'}));
                    } else if (message['action'] === 'send') {
                        const linkupId = message['linkupId'];
                        const callId   = message['callId'];

                        const linkupIdCalls = this.messageCallbacks.get(linkupId);
                        let found = false;
                        if (linkupIdCalls !== undefined) {
                            let callMessageCallbacks = linkupIdCalls.get(callId);
                            if (callMessageCallbacks !== undefined) {
                                callMessageCallbacks.forEach((callback: MessageCallback) => {
                                    LinkupServerConnection.logger.debug('Delivering linkup message to ' + linkupId + ' on call ' + message['callId']);
                                    callback(message['data']);
                                    found = true;
                                });
                            }
                        }

                        if (!found) {
                            found = false;
                            let linkupIdCallbacks = this.newCallMessageCallbacks.get(linkupId);
                            if (linkupIdCallbacks !== undefined) {
                                linkupIdCallbacks.forEach((callback: NewCallMessageCallback) => {
                                    LinkupServerConnection.logger.debug('Calling default callback for linkupId ' + linkupId + ', unlistened callId is ' + callId);
                                    callback(new LinkupAddress(message['replyServerUrl'], message['replyLinkupId']), callId, message['data']);
                                    found = true;
                                })
                            }

                            if (!found) {
                                LinkupServerConnection.logger.warning('Received message for unlistened linkupId: ' + linkupId);
                            }
                        }
                    } else {
                        LinkupServerConnection.logger.info('received unknown message on ' + this.serverURL + ': ' + ev.data);
                    }
                }
      
                this.ws.onopen = () => {
                    LinkupServerConnection.logger.debug('done creating websocket to URL ' + this.serverURL);
                    this.setUpListeners();
                    this.emptyMessageQueue();
                }
            }
            return false;
        }
    }

    setUpListeners() {
        for (let linkupId of this.linkupIdsToListen) {
            this.setUpListener(linkupId);
        }
    }

    setUpListenerIfNew(linkupId: string) {
        if (!this.linkupIdsToListen.has(linkupId)) {
            this.setUpListener(linkupId);
            this.linkupIdsToListen.add(linkupId);
        }
    }

    // Notice this function is idempotent
    setUpListener(linkupId: string) {

        // check if we need to send a LISTEN message
        if (this.ws !== null && this.ws.readyState === this.ws.OPEN) {
            this.ws.send(JSON.stringify({'action': 'listen', 'linkupId': linkupId}));
            LinkupServerConnection.logger.debug('sending listen command through websocket for linkupId ' + linkupId);
        }
    }

    private emptyMessageQueue() {
        if (this.checkWebsocket()) {
            LinkupServerConnection.logger.debug('about to empty message queue to ' +
                                            this.serverURL + ' (' + this.messageQueue.length +
                                            ' messages to send)');
            while (this.messageQueue.length > 0) {
                let message = this.messageQueue.shift() as string;
                let ws      = this.ws as WebSocket;
                LinkupServerConnection.logger.trace('about to send this to ' + this.serverURL);
                LinkupServerConnection.logger.trace(message);
                ws.send(message);
            }
        }
    }

    private enqueueAndSend(message: string) {
        this.messageQueue.push(message);
        this.emptyMessageQueue();
    }

}

export { LinkupServerConnection, NewCallMessageCallback as CallCallback, MessageCallback };