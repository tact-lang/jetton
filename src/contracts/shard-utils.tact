const prefix_length: Int = 8;

struct ShardDeployParameters {
    /// An 8-bit value that configures how to send a message, defaults to 0.
    /// See: https://docs.tact-lang.org/book/message-mode
    mode: Int = SendDefaultMode;

    /// Optional message body as a `Cell`.
    body: Cell;

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

inline fun changeAddressHashPrefix(addr_hash: Int, prefix: Int): Int {
    return (addr_hash & ((1 << (256 - prefix_length)) - 1)) | (prefix << (256 - prefix_length));
}

inline fun getShardFromAddress(addr: Slice): Int {
    addr.skipBits(11);
    return addr.loadUint(prefix_length);
}

inline fun shardDeploy(params: ShardDeployParameters) {
    let newStateInit = beginCell()
        .storeUint(1, 1)
        .storeUint(prefix_length, 5)
        .storeUint(0, 1)
        .storeMaybeRef(params.init.code)
        .storeMaybeRef(params.init.data)
        .storeUint(0, 1)
        .endCell();

    let expectedAddr = beginCell()
        .storeUint(4, 3)
        .storeUint(0, 8)
        .storeUint(changeAddressHashPrefix(newStateInit.hash(), params.shard), 256) // 
        .asSlice();

    let parsedAddr = parseStdAddress(expectedAddr);
    let realAddr = beginCell()
        .storeUint(4, 3)
        .storeUint(0, 8)
        .storeUint(parsedAddr.address, 256) // First 32 bits of address will be 0
        .asSlice();

    let msg = beginCell()
        .storeUint(0x18, 6)
        .storeSlice(realAddr)
        .storeCoins(0)
        .storeUint(4 + 2 + 1, 1 + 4 + 4 + 64 + 32 + 1 + 1 + 1)
        .storeRef(newStateInit)
        .storeRef(params.body)
        .endCell();

    sendRawMessage(msg, params.mode);
}

inline fun initToPrefixInit(init: StateInit): Cell {
    let newStateInit = beginCell()
        .storeUint(1, 1)
        .storeUint(prefix_length, 5)
        .storeUint(0, 1)
        .storeMaybeRef(init.code)
        .storeMaybeRef(init.data)
        .storeUint(0, 1)
        .endCell();
    return newStateInit;
}

inline fun contractBasechainAddressPrefix(s: StateInit): BasechainAddress {
    let hash = initToPrefixInit(s).hash();
    return newBasechainAddress(hash);
}

inline extends fun hasSameBasechainAddressPrefix(self: StateInit, sender: Address): Bool {
    let senderAddress = parseStdAddress(sender.asSlice()).address;
    let baseAddress = contractBasechainAddressPrefix(self);
    return (baseAddress.hash!! & ((1 << (256 - prefix_length)) - 1)) == (senderAddress & ((1 << (256 - prefix_length)) - 1));
}
