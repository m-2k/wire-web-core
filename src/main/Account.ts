import * as Proteus from 'wire-webapp-proteus';
import Client = require('@wireapp/api-client');
import SessionPayloadBundle from './SessionPayloadBundle';
import {ClientMismatch, OTRRecipients, UserClients, NewOTRMessage} from '@wireapp/api-client/src/main/conversation';
import {Context, LoginData} from '@wireapp/api-client/dist/commonjs/auth';
import {CRUDEngine} from '@wireapp/store-engine/dist/commonjs/engine';
import {Cryptobox, store} from 'wire-webapp-cryptobox';
import {Encoder, Decoder} from 'bazinga64';
import {NewClient, RegisteredClient} from '@wireapp/api-client/dist/commonjs/client/index';
import {OTRMessageAdd} from '@wireapp/api-client/dist/commonjs/conversation/event';
import {PreKey} from '@wireapp/api-client/dist/commonjs/auth';
import {RecordNotFoundError} from '@wireapp/store-engine/dist/commonjs/engine/error';
import {UserPreKeyBundleMap} from '@wireapp/api-client/dist/commonjs/user';
import {WebSocketClient} from '@wireapp/api-client/dist/commonjs/tcp/';

export default class Account {
  private apiClient: Client;
  private client: RegisteredClient;
  private context: Context;
  private cryptobox: Cryptobox;
  private loginData: LoginData;
  private storeEngine: CRUDEngine;

  static get STORES() {
    return {
      CLIENTS: 'clients'
    };
  }

  constructor(loginData: LoginData, storeEngine: CRUDEngine) {
    this.loginData = loginData;
    this.storeEngine = storeEngine;
    this.apiClient = new Client({store: storeEngine});
    this.cryptobox = new Cryptobox(new store.CryptoboxCRUDStore(storeEngine));
  }

  private loadExistingClient(): Promise<RegisteredClient> {
    return this.cryptobox.load()
      .then((initialPreKeys: Array<Proteus.keys.PreKey>) => {
        return this.storeEngine.read<RegisteredClient>(Account.STORES.CLIENTS, store.CryptoboxCRUDStore.KEYS.LOCAL_IDENTITY);
      });
  }

  private registerNewClient(): Promise<RegisteredClient> {
    return this.cryptobox.create()
      .then((initialPreKeys: Array<Proteus.keys.PreKey>) => {
        const serializedPreKeys: Array<PreKey> = initialPreKeys
          .map((preKey) => {
            const preKeyJson: PreKey = this.cryptobox.serialize_prekey(preKey);
            if (preKeyJson.id !== 65535) return preKeyJson;
            return undefined;
          })
          .filter((serializedPreKey) => serializedPreKey);

        // TODO: Make the client values configurable from outside
        const newClient: NewClient = {
          class: 'desktop',
          cookie: 'webapp@1224301118@temporary@1472638149000',
          lastkey: this.cryptobox.serialize_prekey(this.cryptobox.lastResortPreKey),
          password: this.loginData.password.toString(),
          prekeys: serializedPreKeys,
          sigkeys: {
            enckey: 'Wuec0oJi9/q9VsgOil9Ds4uhhYwBT+CAUrvi/S9vcz0=',
            mackey: 'Wuec0oJi9/q9VsgOil9Ds4uhhYwBT+CAUrvi/S9vcz0=',
          },
          type: 'temporary',
        };

        return newClient;
      })
      .then((newClient: NewClient) => this.apiClient.client.api.postClient(newClient))
      .then((client: RegisteredClient) => {
        this.client = client;
        return this.storeEngine.create(Account.STORES.CLIENTS, store.CryptoboxCRUDStore.KEYS.LOCAL_IDENTITY, client);
      })
      .then(() => this.client);
  }

  private initClient(context: Context): Promise<RegisteredClient> {
    this.context = context;
    return this.loadExistingClient()
      .catch((error) => {
        if (error instanceof RecordNotFoundError) {
          return this.registerNewClient();
        }
        throw error;
      });
  }

  public login(): Promise<Context> {
    return this.apiClient.init()
      .catch((error) => this.apiClient.login(this.loginData))
      .then((context: Context) => this.initClient(context))
      .then((client: RegisteredClient) => {
        this.apiClient.context.clientID = client.id;
        this.context = this.apiClient.context;
        return this.context;
      });
  }

  private constructSessionId(userId: string, clientId: string): string {
    return `${userId}@${clientId}`;
  }

  private dismantleSessionId(sessionId: string): Array<string> {
    return sessionId.split('@');
  }

  private encryptPayloadForSession(sessionId: string, typedArray: Uint8Array, decodedPreKeyBundle: Uint8Array): Promise<SessionPayloadBundle> {
    return this.cryptobox.encrypt(sessionId, typedArray, decodedPreKeyBundle.buffer)
      .then((encryptedPayload) => Encoder.toBase64(encryptedPayload).asString)
      .catch((error) => '💣')
      .then((encryptedPayload) => ({sessionId, encryptedPayload}));
  }

  public encrypt(typedArray: Uint8Array, preKeyBundles: UserPreKeyBundleMap): Promise<OTRRecipients> {
    const recipients: OTRRecipients = {};
    const encryptions: Array<Promise<SessionPayloadBundle>> = [];

    for (const userId in preKeyBundles) {
      recipients[userId] = {};
      for (const clientId in preKeyBundles[userId]) {
        const preKeyPayload = preKeyBundles[userId][clientId];
        const preKey = preKeyPayload.key;


        const sessionId: string = this.constructSessionId(userId, clientId);
        const decodedPreKeyBundle: Uint8Array = Decoder.fromBase64(preKey).asBytes;

        encryptions.push(this.encryptPayloadForSession(sessionId, typedArray, decodedPreKeyBundle));
      }
    }

    return Promise.all(encryptions)
      .then((payloads: Array<SessionPayloadBundle>) => {
        const recipients: OTRRecipients = {};

        if (payloads) {
          payloads.forEach((payload: SessionPayloadBundle) => {
            const sessionId: string = payload.sessionId;
            const encrypted: string = payload.encryptedPayload;
            const [userId, clientId] = this.dismantleSessionId(sessionId);
            recipients[userId] = recipients[userId] || {};
            recipients[userId][clientId] = encrypted;
          });
        }

        return recipients;
      });
  }

  public listen(callback: Function): Promise<WebSocketClient> {
    this.apiClient.transport.ws.on(WebSocketClient.TOPIC.ON_MESSAGE, (notification: any) => callback(notification));
    return this.apiClient.connect();
  }

  public sendMessage(conversationId: string, recipients: OTRRecipients): Promise<ClientMismatch> {
    const message: NewOTRMessage = {
      recipients,
      sender: this.context.clientID,
    };
    return this.apiClient.conversation.api.postOTRMessage(this.context.clientID, conversationId, message);
  }

  // TODO: The correct functionality of this function is heavily based on the case that it always runs into the catch block
  public getPreKeyBundles(conversationId: string): Promise<ClientMismatch | UserPreKeyBundleMap> {
    return this.apiClient.conversation.api.postOTRMessage(this.context.clientID, conversationId)
      .catch((error) => {
        if (error.response && error.response.status === 412) {
          const recipients: UserClients = error.response.data.missing;
          return this.apiClient.user.api.postMultiPreKeyBundles(recipients);
        }
        throw error;
      });
  }

  public decrypt(event: OTRMessageAdd): Promise<Uint8Array> {
    const ciphertext: string = event.data.text;
    const sessionId: string = this.constructSessionId(event.from, event.data.sender);
    const messageBytes: Uint8Array = Decoder.fromBase64(ciphertext).asBytes;
    return this.cryptobox.decrypt(sessionId, messageBytes.buffer);
  }
}
