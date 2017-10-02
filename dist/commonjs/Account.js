"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __assign = (this && this.__assign) || Object.assign || function(t) {
    for (var s, i = 1, n = arguments.length; i < n; i++) {
        s = arguments[i];
        for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
            t[p] = s[p];
    }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
var loadProtocolBuffers = require('@wireapp/protocol-messaging');
var UUID = require('pure-uuid');
var _1 = require("@wireapp/store-engine/dist/commonjs/engine/");
var wire_webapp_cryptobox_1 = require("wire-webapp-cryptobox");
var bazinga64_1 = require("bazinga64");
var _2 = require("@wireapp/store-engine/dist/commonjs/engine/error/");
var _3 = require("@wireapp/api-client/dist/commonjs/tcp/");
var Client = require("@wireapp/api-client");
var EventEmitter = require("events");
var Account = (function (_super) {
    __extends(Account, _super);
    function Account(loginData, storeEngine) {
        if (storeEngine === void 0) { storeEngine = new _1.MemoryEngine('temporary'); }
        var _this = _super.call(this) || this;
        _this.protocolBuffers = {};
        _this.loginData = __assign({ persist: !(storeEngine instanceof _1.MemoryEngine) }, loginData);
        _this.storeEngine = storeEngine;
        _this.apiClient = new Client({ store: storeEngine });
        _this.cryptobox = new wire_webapp_cryptobox_1.Cryptobox(new wire_webapp_cryptobox_1.store.CryptoboxCRUDStore(storeEngine));
        return _this;
    }
    Object.defineProperty(Account, "STORES", {
        get: function () {
            return {
                CLIENTS: 'clients'
            };
        },
        enumerable: true,
        configurable: true
    });
    Account.prototype.loadExistingClient = function () {
        var _this = this;
        return this.cryptobox.load()
            .then(function (initialPreKeys) {
            return _this.storeEngine.read(Account.STORES.CLIENTS, wire_webapp_cryptobox_1.store.CryptoboxCRUDStore.KEYS.LOCAL_IDENTITY);
        });
    };
    Account.prototype.registerNewClient = function () {
        var _this = this;
        return this.cryptobox.create()
            .then(function (initialPreKeys) {
            var serializedPreKeys = initialPreKeys
                .map(function (preKey) {
                var preKeyJson = _this.cryptobox.serialize_prekey(preKey);
                if (preKeyJson.id !== 65535)
                    return preKeyJson;
                return undefined;
            })
                .filter(function (serializedPreKey) { return serializedPreKey; });
            var newClient = {
                class: 'desktop',
                cookie: 'webapp@1224301118@temporary@1472638149000',
                lastkey: _this.cryptobox.serialize_prekey(_this.cryptobox.lastResortPreKey),
                password: _this.loginData.password.toString(),
                prekeys: serializedPreKeys,
                sigkeys: {
                    enckey: 'Wuec0oJi9/q9VsgOil9Ds4uhhYwBT+CAUrvi/S9vcz0=',
                    mackey: 'Wuec0oJi9/q9VsgOil9Ds4uhhYwBT+CAUrvi/S9vcz0=',
                },
                type: 'temporary',
            };
            return newClient;
        })
            .then(function (newClient) { return _this.apiClient.client.api.postClient(newClient); })
            .then(function (client) {
            _this.client = client;
            return _this.storeEngine.create(Account.STORES.CLIENTS, wire_webapp_cryptobox_1.store.CryptoboxCRUDStore.KEYS.LOCAL_IDENTITY, client);
        })
            .then(function () { return _this.client; });
    };
    Account.prototype.initClient = function (context) {
        var _this = this;
        this.context = context;
        return this.loadExistingClient()
            .catch(function (error) {
            if (error instanceof _2.RecordNotFoundError) {
                return _this.registerNewClient();
            }
            throw error;
        });
    };
    Account.prototype.login = function () {
        var _this = this;
        return this.apiClient.init()
            .catch(function (error) { return _this.apiClient.login(_this.loginData); })
            .then(function (context) { return _this.initClient(context); })
            .then(function (client) {
            _this.apiClient.context.clientID = client.id;
            _this.context = _this.apiClient.context;
            return loadProtocolBuffers();
        })
            .then(function (root) {
            _this.protocolBuffers.GenericMessage = root.lookup('GenericMessage');
            _this.protocolBuffers.Text = root.lookup('Text');
            return _this.context;
        });
    };
    Account.prototype.constructSessionId = function (userId, clientId) {
        return userId + "@" + clientId;
    };
    Account.prototype.dismantleSessionId = function (sessionId) {
        return sessionId.split('@');
    };
    Account.prototype.encryptPayloadForSession = function (sessionId, typedArray, decodedPreKeyBundle) {
        return this.cryptobox.encrypt(sessionId, typedArray, decodedPreKeyBundle.buffer)
            .then(function (encryptedPayload) { return bazinga64_1.Encoder.toBase64(encryptedPayload).asString; })
            .catch(function (error) { return '💣'; })
            .then(function (encryptedPayload) { return ({ sessionId: sessionId, encryptedPayload: encryptedPayload }); });
    };
    Account.prototype.encrypt = function (typedArray, preKeyBundles) {
        var _this = this;
        var recipients = {};
        var encryptions = [];
        for (var userId in preKeyBundles) {
            recipients[userId] = {};
            for (var clientId in preKeyBundles[userId]) {
                var preKeyPayload = preKeyBundles[userId][clientId];
                var preKey = preKeyPayload.key;
                var sessionId = this.constructSessionId(userId, clientId);
                var decodedPreKeyBundle = bazinga64_1.Decoder.fromBase64(preKey).asBytes;
                encryptions.push(this.encryptPayloadForSession(sessionId, typedArray, decodedPreKeyBundle));
            }
        }
        return Promise.all(encryptions)
            .then(function (payloads) {
            var recipients = {};
            if (payloads) {
                payloads.forEach(function (payload) {
                    var sessionId = payload.sessionId;
                    var encrypted = payload.encryptedPayload;
                    var _a = _this.dismantleSessionId(sessionId), userId = _a[0], clientId = _a[1];
                    recipients[userId] = recipients[userId] || {};
                    recipients[userId][clientId] = encrypted;
                });
            }
            return recipients;
        });
    };
    Account.prototype.listen = function (callback) {
        var _this = this;
        return Promise.resolve()
            .then(function () {
            if (!_this.context) {
                return _this.login();
            }
            return undefined;
        }).then(function () {
            if (callback) {
                _this.apiClient.transport.ws.on(_3.WebSocketClient.TOPIC.ON_MESSAGE, function (notification) { return callback(notification); });
            }
            else {
                _this.apiClient.transport.ws.on(_3.WebSocketClient.TOPIC.ON_MESSAGE, _this.handleNotification.bind(_this));
            }
            return _this.apiClient.connect();
        });
    };
    Account.prototype.handleNotification = function (notification) {
        var _this = this;
        for (var _i = 0, _a = notification.payload; _i < _a.length; _i++) {
            var event_1 = _a[_i];
            this.handleEvent(event_1)
                .then(function (payload) {
                if (payload.content) {
                    _this.emit(Account.INCOMING.TEXT_MESSAGE, payload);
                }
            });
        }
    };
    Account.prototype.handleEvent = function (event) {
        var conversation = event.conversation, from = event.from;
        return this.decodeEvent(event)
            .then(function (content) {
            return {
                content: content,
                conversation: conversation,
                from: from,
            };
        });
    };
    Account.prototype.decodeEvent = function (event) {
        var _this = this;
        return new Promise(function (resolve) {
            switch (event.type) {
                case 'conversation.otr-message-add':
                    var otrMessage = event;
                    _this.decrypt(otrMessage)
                        .then(function (decryptedMessage) {
                        var genericMessage = _this.protocolBuffers.GenericMessage.decode(decryptedMessage);
                        switch (genericMessage.content) {
                            case 'text':
                                resolve(genericMessage.text.content);
                                break;
                            default:
                                resolve(undefined);
                        }
                    });
                    break;
            }
        });
    };
    Account.prototype.sendTextMessage = function (conversationId, message) {
        var _this = this;
        var customTextMessage = this.protocolBuffers.GenericMessage.create({
            messageId: new UUID(4).format(),
            text: this.protocolBuffers.Text.create({ content: message })
        });
        return this.getPreKeyBundles(conversationId)
            .then(function (preKeyBundles) {
            var typedArray = _this.protocolBuffers.GenericMessage.encode(customTextMessage).finish();
            return _this.encrypt(typedArray, preKeyBundles);
        })
            .then(function (payload) { return _this.sendMessage(conversationId, payload); });
    };
    Account.prototype.sendMessage = function (conversationId, recipients) {
        var message = {
            recipients: recipients,
            sender: this.context.clientID,
        };
        return this.apiClient.conversation.api.postOTRMessage(this.context.clientID, conversationId, message);
    };
    Account.prototype.getPreKeyBundles = function (conversationId) {
        var _this = this;
        return this.apiClient.conversation.api.postOTRMessage(this.context.clientID, conversationId)
            .catch(function (error) {
            if (error.response && error.response.status === 412) {
                var recipients = error.response.data.missing;
                return _this.apiClient.user.api.postMultiPreKeyBundles(recipients);
            }
            throw error;
        });
    };
    Account.prototype.decrypt = function (event) {
        var ciphertext = event.data.text;
        var sessionId = this.constructSessionId(event.from, event.data.sender);
        var messageBytes = bazinga64_1.Decoder.fromBase64(ciphertext).asBytes;
        return this.cryptobox.decrypt(sessionId, messageBytes.buffer);
    };
    Account.INCOMING = {
        TEXT_MESSAGE: 'Account.INCOMING.TEXT_MESSAGE',
    };
    return Account;
}(EventEmitter));
exports.default = Account;
