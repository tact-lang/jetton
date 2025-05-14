import "./shard-utils";


// NEW USAGE 
// DeployParameters.send()
// SendParameters.send()
// MessageParameters.send()


asm extends inline fun send(self: DeployParameters) {
    // Instructions are grouped, and the stack states they produce as a group are shown right after.
    //
    // → Stack state
    // s0: `params.init.data`
    // s1: `params.init.code`
    // s2: `params.bounce`
    // s3: `params.value`
    // s4: `params.body`
    // s5: `params.mode`
    // For brevity, the "params" prefix will be omitted from now on.

    // Group 1: Preparation of needed params
    // For almost identical logic and instructions,
    // see comments inside `contractHash()` function in contract.tact
    4 1 BLKPUSH // pushes 2 copies of `init.code` and `init.data`
    HASHCU // `init.data` hash
    SWAP
    HASHCU // `init.code` hash
    SWAP2
    CDEPTH // `init.data` depth
    SWAP
    CDEPTH // `init.code` depth

    // Group 2: Calculating destination address
    // For almost identical logic and instructions,
    // see comments inside `contractHash()` function in contract.tact
    131380 INT // (2 << 16) | (1 << 8) | 0x34
    NEWC
    24 STU
    16 STU
    16 STU
    256 STU
    256 STU
    ONE HASHEXT_SHA256 // obtains hash part (account id) of the address
    // → Stack state
    // s0: destAddr(hash part)
    // s1: `init.data`
    // s2: `init.code`
    // s3 and below: `bounce`, `value`, `body`, `mode`

    // Group 3: Building a message (CommonMsgInfoRelaxed)
    s3 XCHG0           // swaps `bounce` with destAddr(hash part)
    NEWC
    b{01} STSLICECONST // store tag = $0 and ihr_disabled = true
    1 STI              // store `bounce`
    s1 s2 XCHG         // swap `init.data` with `init.code`, placing code on s1
    STREF              // store `init.code`
    STREF              // store `init.data`
    // Inline StateInit:
    b{00010000000000} STSLICECONST
    // 0 + 00 + 10 + 0 + 00000000
    // 1) 0 - bounced = false
    // 2) 00 - src = addr_none
    // 3) 10 - tag of addr_std (part of dest)
    // 4) 0 - Maybe Anycast = false
    // 5) 00000000 - workchain_id (part of dest)
    //
    256 STU     // store destAddr(hash part)
    SWAP        // Builder on top, `value` below
    STGRAMS     // store `value`
    105 PUSHINT // 1 + 4 + 4 + 64 + 32
    STZEROES    // store currency_collection, ihr_fee, fwd_fee, created_lt and created_at

    // Group 4: Continue building a message (CommonMsgInfoRelaxed into MessageRelaxed)
    // Remaining bits of MessageRelaxed:
    b{1000110} STSLICECONST
    // 10 + 0 + 0 + 1 + 1 + 0
    // 10 - Maybe (Either StateInit ^StateInit) = true false
    // 0 - split_depth:(Maybe (## 5)) = false
    // 0 = special:(Maybe TickTock) = false
    // 1 = code:(Maybe ^Cell) = true
    // 1 = data:(Maybe ^Cell) = true
    // 0 = library:(Maybe ^Cell) = false
    //
    STDICT // store `body` as ref with an extra Maybe bit, since `body` might be null
    ENDC   // finalize the message
    // → Stack state
    // s0: Cell
    // s1: params.`mode`

    // Group 5: Sending the message, with `mode` on top
    SWAP
    SENDRAWMSG
}

extends inline fun send(self: ShardDeployParameters) { 
    let newStateInit = self.deployParameters.init.toShardCell();

    let msg = beginCell()
        .storeUint(1, 2) // 0 1 
        .storeBool(self.deployParameters.bounce)
        .storeUint(1 << 10, 14)  // 0 0 0 1 0 0 0 0 0 0 0 0 0 0
        .storeUint(changeAddressHashShard(newStateInit.hash(), self.shard), 256)
        .storeCoins(self.deployParameters.value)
        .storeUint(2 + 1, 1 + 4 + 4 + 64 + 32 + 1 + 1)
        .storeRef(newStateInit)
        .storeMaybeRef(self.deployParameters.body)
        .endCell();

    sendRawMessage(msg, self.deployParameters.mode);
}

extends inline fun send(self: ShardMessageParameters) {
    self.messageParameters.to = changeAddressShard(self.messageParameters.to, self.shard);
    self.messageParameters.send()
}

asm extends inline fun send(self: MessageParameters) {
    NEWC
    b{01} STSLICECONST  // store tag = $0 and ihr_disabled = true
    1 STI               // store `bounce`
    b{000} STSLICECONST // store bounced = false and src = addr_none
    STSLICE             // store `to`
    SWAP
    STGRAMS             // store `value`
    106 PUSHINT         // 1 + 4 + 4 + 64 + 32 + 1
    STZEROES
    // → Stack state
    // s0: Builder
    // s1: `body`
    // s2: `mode`
    STDICT
    ENDC
    SWAP
    SENDRAWMSG
}


asm extends inline fun send(self: SendParameters) {
    // Instructions are grouped, and the stack states they produce as a group are shown right after.
    // In the end, our message Cell should have the following TL-B structure:
    // message$_ {X:Type}
    //   info:CommonMsgInfoRelaxed
    //   init:(Maybe (Either StateInit ^StateInit))
    //   body:(Either X ^X)
    // = MessageRelaxed X;

    // → Stack state
    // s0: `self.bounce`
    // s1: `self.to`
    // s2: `self.value`
    // s3: `self.data`
    // s4: `self.code`
    // s5: `self.body`
    // s6: `self.mode`
    // For brevity, the "self" prefix will be omitted from now on.

    // Group 1: Storing the `bounce`, `to` and `value` into a Builder
    NEWC
    b{01} STSLICECONST  // store tag = $0 and ihr_disabled = true
    1 STI               // store `bounce`
    b{000} STSLICECONST // store bounced = false and src = addr_none
    STSLICE             // store `to`
    SWAP
    STGRAMS             // store `value`
    105 PUSHINT         // 1 + 4 + 4 + 64 + 32
    STZEROES            // store currency_collection, ihr_fee, fwd_fee, created_lt and created_at
    // → Stack state
    // s0: Builder
    // s1: `data`
    // s2: `code`
    // s3: `body`
    // s4: `mode`

    // Group 2: Placing the Builder after code and data, then checking those for nullability
    s2 XCHG0
    DUP2
    ISNULL
    SWAP
    ISNULL
    AND
    // → Stack state
    // s0: -1 (true) if `data` and `code` are both null, 0 (false) otherwise
    // s1: `code`
    // s2: `data`
    // s3: Builder
    // s4: `body`
    // s5: `mode`

    // Group 3: Left branch of the IFELSE, executed if s0 is -1 (true)
    <{
        DROP2 // drop `data` and `code`, since either of those is null
        b{0} STSLICECONST
    }> PUSHCONT

    // Group 3: Right branch of the IFELSE, executed if s0 is 0 (false)
    <{
        // _ split_depth:(Maybe (## 5))
        //   special:(Maybe TickTock)
        //   code:(Maybe ^Cell)
        //   data:(Maybe ^Cell)
        //   library:(Maybe ^Cell)
        // = StateInit;
        ROT                // place message Builder on top
        b{10} STSLICECONST // store Maybe = true, Either = false
        // Start composing inlined StateInit
        b{00} STSLICECONST // store split_depth and special first
        STDICT             // store code
        STDICT             // store data
        b{0} STSLICECONST  // store library
    }> PUSHCONT

    // Group 3: IFELSE that does the branching shown above
    IFELSE
    // → Stack state
    // s0: Builder
    // s1: null or StateInit
    // s2: `body`
    // s3: `mode`

    // Group 4: Finalizing the message
    STDICT // store `body` as ref with an extra Maybe bit, since `body` might be null
    ENDC
    // → Stack state
    // s0: Cell
    // s1: `mode`

    // Group 5: Sending the message, with `mode` on top
    SWAP
    SENDRAWMSG // https://github.com/tact-lang/tact/issues/1558
}

