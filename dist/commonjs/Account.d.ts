/// <reference types="node" />
import { ClientMismatch, OTRRecipients } from '@wireapp/api-client/src/main/conversation/';
import { Context, LoginData } from '@wireapp/api-client/dist/commonjs/auth/';
import { OTRMessageAdd } from '@wireapp/api-client/dist/commonjs/conversation/event/';
import { CRUDEngine } from '@wireapp/store-engine/dist/commonjs/engine/';
import { UserPreKeyBundleMap } from '@wireapp/api-client/dist/commonjs/user/';
import { WebSocketClient } from '@wireapp/api-client/dist/commonjs/tcp/';
import EventEmitter = require('events');
export default class Account extends EventEmitter {
    private apiClient;
    private client;
    context: Context;
    private cryptobox;
    private loginData;
    private protocolBuffers;
    private storeEngine;
    static readonly STORES: {
        CLIENTS: string;
    };
    static INCOMING: {
        TEXT_MESSAGE: string;
    };
    constructor(loginData: LoginData, storeEngine?: CRUDEngine);
    private loadExistingClient();
    private registerNewClient();
    private initClient(context);
    login(): Promise<Context>;
    private constructSessionId(userId, clientId);
    private dismantleSessionId(sessionId);
    private encryptPayloadForSession(sessionId, typedArray, decodedPreKeyBundle);
    encrypt(typedArray: Uint8Array, preKeyBundles: UserPreKeyBundleMap): Promise<OTRRecipients>;
    listen(callback: Function): Promise<WebSocketClient>;
    private handleNotification(notification);
    private handleEvent(event);
    private decodeEvent(event);
    sendTextMessage(conversationId: string, message: string): Promise<ClientMismatch>;
    sendMessage(conversationId: string, recipients: OTRRecipients): Promise<ClientMismatch>;
    getPreKeyBundles(conversationId: string): Promise<ClientMismatch | UserPreKeyBundleMap>;
    decrypt(event: OTRMessageAdd): Promise<Uint8Array>;
}
