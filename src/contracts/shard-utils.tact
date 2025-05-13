const prefixLength: Int = 8;

struct ShardDeployParameters {
    /// An 8-bit value that configures how to send a message, defaults to 0.
    /// See: https://docs.tact-lang.org/book/message-mode
    mode: Int = SendDefaultMode;

    /// Optional message body as a `Cell`.
    body: Cell?;

    /// The amount of nanoToncoins you want to send with
    /// the message. This value is used to cover forward fees,
    /// unless the optional flag `SendPayGasSeparately` is used.
    value: Int;

    /// When set to `true` (default) message bounces back to the sender if
    /// the recipient contract doesn't exist or wasn't able to process the message.
    bounce: Bool = true;

    /// Initial package of the contract (initial code and initial data).
    /// See: https://docs.tact-lang.org/book/expressions#initof
    init: StateInit;

    /// The shard number to deploy the contract to.
    shard: Int as uint8;
}

inline fun changeAddressHashShard(addr_hash: Int, shard: Int): Int {
    return (addr_hash & ((1 << (256 - prefixLength)) - 1)) | (shard << (256 - prefixLength));
}

inline fun getShardFromAddress(addr: Slice): Int {
    addr.skipBits(11);
    return addr.loadUint(prefixLength);
}

inline fun shardDeploy(params: ShardDeployParameters) {
    let newStateInit = initToShardInit(params.init);

    let expectedAddr = beginCell()
        .storeUint(4, 3)
        .storeUint(0, 8)
        .storeUint(changeAddressHashShard(newStateInit.hash(), params.shard), 256)
        .asSlice();

    let msg = beginCell()
        .storeUint(1, 2) // 0 1 
        .storeBool(params.bounce)
        .storeUint(0, 3) // 0 0 0
        .storeSlice(expectedAddr)
        .storeCoins(params.value)
        .storeUint(2 + 1, 1 + 4 + 4 + 64 + 32 + 1 + 1)
        .storeRef(newStateInit)
        .storeMaybeRef(params.body)
        .endCell();

    sendRawMessage(msg, params.mode);
}

inline fun initToShardInit(init: StateInit): Cell {
    let newStateInit = beginCell()
        .storeUint(32 + prefixLength, 6)
        .storeUint(6, 4) // 0 1 1 0 
        .storeRef(init.code)
        .storeRef(init.data)
        .endCell();

    return newStateInit;
}

inline fun contractBasechainAddressShard(s: StateInit): BasechainAddress {
    let hash = initToShardInit(s).hash();
    return newBasechainAddress(hash);
}

inline extends fun hasSameBasechainAddressShard(self: StateInit, sender: Address): Bool {
    let senderAddress = parseStdAddress(sender.asSlice()).address;
    let baseAddress = contractBasechainAddressShard(self);
    return (baseAddress.hash!! & ((1 << (256 - prefixLength)) - 1)) == (senderAddress & ((1 << (256 - prefixLength)) - 1));
}
