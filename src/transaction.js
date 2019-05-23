'use strict';
const axios = require('axios')
var util = require('util');
var Event = require('events').EventEmitter;
var utf8 = require('utf8');
var utils = require('./utils');
var Wallet = require('swtc-factory').Wallet;
var sign = require('./local_sign');
const jser = require("swtc-serializer").Serializer
/**
 * Post request to server with account secret
 * @param remote
 * @constructor
 */
function Transaction(remote, filter) {
    Event.call(this);

    var self = this;
    self._token = remote._token || 'swt';
    var fee = utils.getFee(self._token);
    self._remote = remote;
    self.tx_json = {
        Flags: 0,
        Fee: fee
    };
    self._filter = filter || function (v) {
        return v
    };
    self._secret = void 0;
}
util.inherits(Transaction, Event);

Transaction.set_clear_flags = {
    AccountSet: {
        asfRequireDest: 1,
        asfRequireAuth: 2,
        asfDisallowSWT: 3,
        asfDisableMaster: 4,
        asfNoFreeze: 6,
        asfGlobalFreeze: 7
    }
};

Transaction.flags = {
    // Universal flags can apply to any transaction type
    Universal: {
        FullyCanonicalSig: 0x80000000
    },

    AccountSet: {
        RequireDestTag: 0x00010000,
        OptionalDestTag: 0x00020000,
        RequireAuth: 0x00040000,
        OptionalAuth: 0x00080000,
        DisallowSWT: 0x00100000,
        AllowSWT: 0x00200000
    },

    TrustSet: {
        SetAuth: 0x00010000,
        NoSkywell: 0x00020000,
        SetNoSkywell: 0x00020000,
        ClearNoSkywell: 0x00040000,
        SetFreeze: 0x00100000,
        ClearFreeze: 0x00200000
    },

    OfferCreate: {
        Passive: 0x00010000,
        ImmediateOrCancel: 0x00020000,
        FillOrKill: 0x00040000,
        Sell: 0x00080000
    },

    Payment: {
        NoSkywellDirect: 0x00010000,
        PartialPayment: 0x00020000,
        LimitQuality: 0x00040000
    },

    RelationSet: {
        Authorize: 0x00000001,
        Freeze: 0x00000011
    }
};

Transaction.OfferTypes = ['Sell', 'Buy'];
Transaction.RelationTypes = ['trust', 'authorize', 'freeze', 'unfreeze'];
Transaction.AccountSetTypes = ['property', 'delegate', 'signer'];

/**
 * parse json transaction as tx_json
 * @param val
 * @returns {Transaction}
 */
Transaction.prototype.parseJson = function (val) {
    this.tx_json = val;
    return this;
};

/**
 * get transaction account
 * @returns {Transaction.tx_json.Account}
 */
Transaction.prototype.getAccount = function () {
    return this.tx_json.Account;
};

/**
 * get transaction type
 * @returns {exports.result.TransactionType|*|string}
 */
Transaction.prototype.getTransactionType = function () {
    return this.tx_json.TransactionType;
};

/**
 * set secret
 * @param secret
 */
Transaction.prototype.setSecret = function (secret) {
    if (!Wallet.isValidSecret(secret, this._token)) {
        this.tx_json._secret = new Error('invalid secret');
        return;
    }
    this._secret = secret;
};

/**
 * just only memo data
 * @param memo
 */
Transaction.prototype.addMemo = function (memo) {
    if (typeof memo !== 'string') {
        this.tx_json.memo_type = new TypeError('invalid memo type');
        return this;
    }
    if (memo.length > 2048) {
        this.tx_json.memo_len = new TypeError('memo is too long');
        return this;
    }
    var _memo = {};
    _memo.MemoData = utils.stringToHex(utf8.encode(memo));
    this.tx_json.Memos = (this.tx_json.Memos || []).concat({
        Memo: _memo
    });
};

Transaction.prototype.setFee = function (fee) {
    var _fee = parseInt(fee);
    if (isNaN(_fee)) {
        this.tx_json.Fee = new TypeError('invalid fee');
        return this;
    }
    if (fee < 10) {
        this.tx_json.Fee = new TypeError('fee is too low');
        return this;
    }
    this.tx_json.Fee = _fee;
};

/**
 * set source tag
 * source tag is a 32 bit integer or undefined
 * @param tag
 */
/*
Transaction.prototype.setSourceTag = function(tag) {
    if (typeof tag !== Number || !isFinite(tag)) {
        throw new Error('invalid tag type');
    }
    this.tx_json.SourceTag = tag;
};

Transaction.prototype.setDestinationTag = function(tag) {
    if (typeof tag !== Number || !isFinite(tag)) {
        throw new Error('invalid tag type');
    }
    this.tx_json.DestinationTag = tag;
};
*/

function MaxAmount(amount, token) {
    if (typeof amount === 'string' && Number(amount)) {
        var _amount = parseInt(Number(amount) * (1.0001));
        return String(_amount);
    }
    if (typeof amount === 'object' && utils.isValidAmount(amount, token)) {
        var _value = Number(amount.value) * (1.0001);
        amount.value = String(_value);
        return amount;
    }
    return new Error('invalid amount to max');
}

/**
 * set a path to payment
 * this path is repesented as a key, which is computed in path find
 * so if one path you computed self is not allowed
 * when path set, sendmax is also set.
 * @param path
 */
Transaction.prototype.setPath = function (key) {
    // sha1 string
    if (typeof key !== 'string' || key.length !== 40) {
        return new Error('invalid path key');
    }
    var item = this._remote._paths.get(key);
    if (!item) {
        return new Error('non exists path key');
    }
    if (item.path === '[]') { // 沒有支付路径，不需要传下面的参数
        return;
    }
    var path = JSON.parse(item.path);
    this.tx_json.Paths = path;
    var amount = MaxAmount(item.choice, this._token);
    this.tx_json.SendMax = amount;
};

/**
 * limit send max amount
 * @param amount
 */
Transaction.prototype.setSendMax = function (amount) {
    if (!utils.isValidAmount(amount, this._token)) {
        return new Error('invalid send max amount');
    }
    this.tx_json.SendMax = amount;
};

/**
 * transfer rate
 * between 0 and 1, type is number
 * @param rate
 */
Transaction.prototype.setTransferRate = function (rate) {
    if (typeof rate !== 'number' || rate < 0 || rate > 1) {
        return new Error('invalid transfer rate');
    }
    this.tx_json.TransferRate = (rate + 1) * 1e9;
};

/**
 * set transaction flags
 *
 */
Transaction.prototype.setFlags = function (flags) {
    if (flags === void 0) return;

    if (typeof flags === 'number') {
        this.tx_json.Flags = flags;
        return;
    }
    var transaction_flags = Transaction.flags[this.getTransactionType()] || {};
    var flag_set = Array.isArray(flags) ? flags : [].concat(flags);
    for (var i = 0; i < flag_set.length; ++i) {
        var flag = flag_set[i];
        if (transaction_flags.hasOwnProperty(flag)) {
            this.tx_json.Flags += transaction_flags[flag];
        }
    }
};

/* set sequence */
Transaction.prototype.setSequence = function (sequence) {
    if (!/^\+?[1-9][0-9]*$/.test(sequence)) { // 正整数
        this.tx_json.Sequence = new TypeError('invalid sequence');
        return this;
    }

    this.tx_json.Sequence = Number(sequence);
};

function signing(self, callback) {
    self.tx_json.Fee = self.tx_json.Fee / 1000000;

    // payment
    if (self.tx_json.Amount && JSON.stringify(self.tx_json.Amount).indexOf('{') < 0) { // 基础货币
        self.tx_json.Amount = Number(self.tx_json.Amount) / 1000000;
    }
    if (self.tx_json.Memos) {
        var memos = self.tx_json.Memos;
        for (var i = 0; i < memos.length; i++) {
            memos[i].Memo.MemoData = utf8.decode(utils.hexToString(memos[i].Memo.MemoData));
        }
    }
    if (self.tx_json.SendMax && typeof self.tx_json.SendMax === 'string') {
        self.tx_json.SendMax = Number(self.tx_json.SendMax) / 1000000;
    }

    // order
    if (self.tx_json.TakerPays && JSON.stringify(self.tx_json.TakerPays).indexOf('{') < 0) { // 基础货币
        self.tx_json.TakerPays = Number(self.tx_json.TakerPays) / 1000000;
    }
    if (self.tx_json.TakerGets && JSON.stringify(self.tx_json.TakerGets).indexOf('{') < 0) { // 基础货币
        self.tx_json.TakerGets = Number(self.tx_json.TakerGets) / 1000000;
    }
    try {
        var seed = {
            seed: self._secret
        }
        self.tx_json.blob = sign(self.tx_json, seed, self._token);
        self._local_sign = true;
        callback(null, self.tx_json.blob);
    } catch (e) {
        callback(e);
    }
}

Transaction.prototype.sign = function (callback) {
    var self = this;
    if (self.tx_json.Sequence) {
        signing(self, callback);
    } else {
        var req = this._remote.requestAccountInfo({
            account: self.tx_json.Account,
            type: 'trust'
        });
        req.submit(function (err, data) {
            if (err) return callback(err);
            self.tx_json.Sequence = data.account_data.Sequence;
            signing(self, callback);
        });
    }
};

Transaction.prototype.signPromise = async function(secret = "", memo = "", sequence = 0) {
    var self = this;
    if (!self.tx_json) {
        return Promise.reject("a valid transaction is expected")
    } else if ("blob" in self.tx_json) {
        return Promise.resolve(self.tx_json.blob)
    } else {
        for (const key in self.tx_json) {
            if (self.tx_json[key] instanceof Error) {
                return Promise.reject(self.tx_json[key].message)
            }
        }
        try {
            if (memo) {
                self.addMemo(memo)
            }
            if (sequence) {
                self.setSequence(sequence)
            }
        } catch (error) {
            return Promise.reject(error)
        }
        if (!self._secret) {
            if (!secret) {
                return Promise.reject("a valid secret is needed to sign with")
            } else {
                self._secret = secret
            }
        } // has _secret now
        if (!self.tx_json.Sequence) {
            try {
                await self._setSequencePromise()
                await self._signPromise()
                return Promise.resolve(self.tx_json.blob)
            } catch (error) {
                return Promise.reject(error)
            }
            // has tx_json.Sequence now
        } else {
            try {
                await self._signPromise()
                return Promise.resolve(self.tx_json.blob)
            } catch (error) {
                return Promise.reject(error)
            }
        }
    }
}

/**
 * submit request to server
 * @param callback
 */
Transaction.prototype.submit = function (callback) {
    var self = this;
    for (var key in self.tx_json) {
        if (self.tx_json[key] instanceof Error) {
            return callback(self.tx_json[key].message);
        }
    }

    var data = {};
    if (self.tx_json.TransactionType === 'Signer') { // 直接将blob传给底层
        data = {
            tx_blob: self.tx_json.blob
        };
        self._remote._submit('submit', data, self._filter, callback);
    } else if (self._remote._local_sign) { // 签名之后传给底层
        self.sign(function (err) {
            if (err) {
                return callback('sign error: ' + err);
            } else {
                var data = {
                    tx_blob: self.tx_json.blob
                };
                self._remote._submit('submit', data, self._filter, callback);
            }
        });
    } else { // 不签名交易传给底层
        data = {
            secret: self._secret,
            tx_json: self.tx_json
        };
        self._remote._submit('submit', data, self._filter, callback);
    }
};

Transaction.prototype.submitPromise = async function (secret = "", memo = "", sequence = 0) {
    const self = this
    for (const key in self.tx_json) {
        if (self.tx_json[key] instanceof Error) {
            return Promise.reject(self.tx_json[key].message)
        }
    }
    try {
        const blob = await self.signPromise(secret, memo, sequence)
        const data = { blob }
        if ("_submit" in self._remote) {
            // lib remote
            return new Promise((resolve, reject) => {
                const callback = (error, result) => {
                    if (error) {
                        reject(error)
                    } else {
                        resolve(result)
                    }
                }
                self._remote._submit(
                    "submit",
                    { tx_blob: blob },
                    self._filter,
                    callback
                )
            })
        } else if ("txSubmitPromise" in self._remote) {
            // api remote
            return self._remote.txSubmitPromise(self)
        } else if ("_axios" in self._remote) {
            // api remote
            return self._remote._axios.post(`blob`, data)
        } else {
            // use api.jingtum.com directly
            return axios.post(`https://api.jingtum.com/v2/blob`, data)
        }
    } catch (error) {
        return Promise.reject(error)
    }
}

Transaction.prototype._signPromise = async function () {
    var self = this;
    self.tx_json.Fee = self.tx_json.Fee / 1000000
    // payment
    if (
        self.tx_json.Amount &&
        JSON.stringify(self.tx_json.Amount).indexOf("{") < 0
    ) {
        // 基础货币
        self.tx_json.Amount = Number(self.tx_json.Amount) / 1000000
    }
    if (self.tx_json.Memos) {
        const memos = self.tx_json.Memos
        for (const memo of memos) {
            memo.Memo.MemoData = utf8.decode(
                utils.hexToString(memo.Memo.MemoData)
            )
        }
    }
    if (self.tx_json.SendMax && typeof self.tx_json.SendMax === "string") {
        self.tx_json.SendMax = Number(self.tx_json.SendMax) / 1000000
    }
    // order
    if (
        self.tx_json.TakerPays &&
        JSON.stringify(self.tx_json.TakerPays).indexOf("{") < 0
    ) {
        // 基础货币
        self.tx_json.TakerPays = Number(self.tx_json.TakerPays) / 1000000
    }
    if (
        self.tx_json.TakerGets &&
        JSON.stringify(self.tx_json.TakerGets).indexOf("{") < 0
    ) {
        // 基础货币
        self.tx_json.TakerGets = Number(self.tx_json.TakerGets) / 1000000
    }
    return new Promise((resolve, reject) => {
        try {
            const wt = new Wallet(self._secret, self._token)
            self.tx_json.SigningPubKey = wt.getPublicKey(self._token)
            const prefix = 0x53545800
            const hash = jser.from_json(self.tx_json, self._token).hash(prefix)
            self.tx_json.TxnSignature = wt.signTx(hash, self._token)
            self.tx_json.blob = jser.from_json(self.tx_json, self._token).to_hex()
            resolve(self)
        } catch (error) {
            reject(error)
        }
    })
}

Transaction.prototype._setSequencePromise = async function () {
    var self = this
    let data
    let response
    try {
        if ("requestAccountInfo" in self._remote) {
            data = await self._remote
                .requestAccountInfo({
                    account: self.tx_json.Account,
                    type: "trust"
                })
                .submitPromise()
            self.tx_json.Sequence = data.account_data.Sequence
            return Promise.resolve(self)
        } else if ("getAccountBalances" in self._remote) {
            data = await self._remote.getAccountBalances(self.tx_json.Account)
            self.tx_json.Sequence = data.sequence
            return Promise.resolve(self)
        } else if ("_axios" in self._remote) {
            response = await self._remote._axios.get(
                `accounts/${self.tx_json.Account}/balances`
            )
            self.tx_json.Sequence = response.data.sequence
            return Promise.resolve(self)
        } else {
            // use api.jingtum.com to get sequence
            response = await axios.get(
                `https://api.jingtum.com/v2/accounts/${
                    self.tx_json.Account
                }/balances`
            )
            self.tx_json.Sequence = response.data.sequence
            return Promise.resolve(self)
        }
    } catch (error) {
        return Promise.reject(error)
    }
}

module.exports = Transaction;
