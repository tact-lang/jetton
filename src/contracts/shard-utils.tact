const prefixLength: Int = 8;

struct ShardDeployParameters {
    deployParameters: DeployParameters;

    /// The shard number to deploy the contract to.
    shard: Int as uint8;
}

struct ShardMessageParameters {
    messageParameters: MessageParameters;

    /// The shard number to deploy the contract to.
    shard: Int as uint8;
}

extends inline fun toShard(self: DeployParameters, shard: Int): ShardDeployParameters {
    return ShardDeployParameters {
        shard,
        deployParameters: self,
    };
}

extends inline fun toShard(self: MessageParameters, shard: Int): ShardMessageParameters {
    return ShardMessageParameters {
        shard,
        messageParameters: self,
    };
}

inline fun changeAddressHashShard(addr_hash: Int, shard: Int): Int {
    return (addr_hash & ((1 << (256 - prefixLength)) - 1)) | (shard << (256 - prefixLength));
}

inline fun changeAddressShard(addr: Address, shard: Int): Address {
    let sl: Slice = addr.asSlice();

    return beginCell().storeUint(sl.loadUint(11), 11).storeUint(changeAddressHashShard(sl.loadUint(256), shard), 256).asSlice().loadAddress();
}

inline fun getShardFromAddress(addr: Slice): Int {
    addr.skipBits(11);
    return addr.loadUint(prefixLength);
}

extends inline fun toShardCell(self: StateInit): Cell {
    let newStateInit = beginCell()
        .storeUint(32 + prefixLength, 6)
        .storeUint(6, 4)
        .storeRef(self.code)
        .storeRef(self.data)
        .endCell();

    return newStateInit;
}

inline fun contractBasechainAddressShard(s: StateInit): BasechainAddress {
    let hash = s.toShardCell().hash();
    return newBasechainAddress(hash);
}

inline extends fun hasSameBasechainAddressShard(self: StateInit, sender: Address): Bool {
    let senderAddress = parseStdAddress(sender.asSlice()).address;
    let baseAddress = contractBasechainAddressShard(self);
    return (baseAddress.hash!! & ((1 << (256 - prefixLength)) - 1)) == (senderAddress & ((1 << (256 - prefixLength)) - 1));
}

inline extends fun hasSameShard(self: Address, b: Address): Bool {
    return getShardFromAddress(self.asSlice()) == getShardFromAddress(b.asSlice());
}
