import Account from './Account';
import {MemoryEngine} from '@wireapp/store-engine/dist/commonjs/engine';
import {load, Root} from 'protobufjs';
import LoginData from '@wireapp/api-client/dist/commonjs/auth/LoginData';
import UserPreKeyBundleMap from '@wireapp/api-client/dist/commonjs/user/UserPreKeyBundleMap';

const UUID = require('pure-uuid');

export default function (handle: string, password: string, conversationID: string, message: string): Promise<any> {
  let customTextMessage: string;
  let GenericMessage: any;
  let Text: any;
  let userAccount: Account;

  return load('node_modules/wire-webapp-protocol-messaging/proto/messages.proto')
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
    .then((context) => userAccount.getPreKeyBundles(conversationID))
    .then((preKeyBundles: UserPreKeyBundleMap) => {
      const typedArray = GenericMessage.encode(customTextMessage).finish();
      return userAccount.encrypt(typedArray, preKeyBundles);
    })
    .then((payload) => userAccount.sendMessage(conversationID, payload));
}
