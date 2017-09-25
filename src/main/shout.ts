const loadProtocolBuffers = require('@wireapp/protocol-messaging');
const UUID = require('pure-uuid');
import Account from './Account';
import {Context, LoginData} from '@wireapp/api-client/dist/commonjs/auth/';
import {MemoryEngine} from '@wireapp/store-engine/dist/commonjs/engine';
import {OTRRecipients} from '@wireapp/api-client/dist/commonjs/conversation/';
import {Root} from 'protobufjs';
import {UserPreKeyBundleMap} from '@wireapp/api-client/dist/commonjs/user/';

export default function (handle: string, password: string, conversationID: string, message: string): Promise<any> {
  let customTextMessage: string;
  let GenericMessage: any;
  let Text: any;
  let userAccount: Account;

  return loadProtocolBuffers()
    .then((root: Root) => {
      GenericMessage = root.lookup('GenericMessage');
      Text = root.lookup('Text');

      customTextMessage = GenericMessage.create({
        messageId: new UUID(4).format(),
        text: Text.create({content: message})
      });

      const loginData: LoginData = {
        handle,
        password,
        persist: false
      };

      const storageEngine = new MemoryEngine(handle);
      userAccount = new Account(loginData, storageEngine);
    })
    .then(() => userAccount.login())
    .then((context: Context) => userAccount.getPreKeyBundles(conversationID))
    .then((preKeyBundles: UserPreKeyBundleMap) => {
      const typedArray = GenericMessage.encode(customTextMessage).finish();
      return userAccount.encrypt(typedArray, preKeyBundles);
    })
    .then((payload: OTRRecipients) => userAccount.sendMessage(conversationID, payload));
}
