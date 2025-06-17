//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Studio

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

asm fun extractLowBits(value: Int, count: Int): Int { 
    MODPOW2
}

inline fun changeShard(hash: Int, shard: Int): Int {
    return extractLowBits(hash, 256 - prefixLength) | (shard << (256 - prefixLength));
}

extends inline fun changeShard(self: Address, shard: Int): Address {
    let sl: Slice = self.asSlice();

    return beginCell().storeUint(sl.loadUint(11), 11).storeUint(changeShard(sl.loadUint(256), shard), 256).asSlice().loadAddress();
}

extends inline fun getShard(self: Address): Int {
    let sl = self.asSlice();
    sl.skipBits(11); // addr_std$10, anycast: false, workchain: int8 
    return sl.loadUint(prefixLength);
}

inline extends fun hasSameShard(self: Address, b: Address): Bool {
    return self.getShard() == b.getShard();
}

extends inline fun storeShardedStateInit(self: Builder, init: StateInit): Builder {
    return self
        .storeUint(32 + prefixLength, 6) // fixed_prefix_length: true, prefixLength: uint5
        .storeUint(6, 4) // special: false, code: true, data: true, library: false 
        .storeRef(init.code)
        .storeRef(init.data);
}

extends inline fun storeStateInit(self: Builder, init: StateInit): Builder {
    return self
        .storeUint(3, 5) // fixed_prefix_length: false, special: false, code: true, data: true, library: false
        .storeRef(init.code)
        .storeRef(init.data);
}

inline fun contractShardBasechainAddress(s: StateInit): BasechainAddress {
    let hash = beginCell().storeShardedStateInit(s).endCell().hash();
    return newBasechainAddress(hash);
}

extends inline fun hasSameBasechainAddressWithoutShard(self: StateInit, address: Address): Bool {
    let addressHash = parseStdAddress(address.asSlice()).address;
    let baseAddress = contractShardBasechainAddress(self);
    return extractLowBits(baseAddress.hash!!, 256 - prefixLength) == extractLowBits(addressHash, 256 - prefixLength);
}
