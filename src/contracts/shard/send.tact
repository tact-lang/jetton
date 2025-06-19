//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Studio

import "./shard-utils";

extends inline fun send(self: DeployParameters) {
    deploy(self);
}

extends inline fun send(self: MessageParameters) {
    message(self);
}

extends inline fun send(self: SendParameters) {
    send(self);
}

extends inline fun send(self: ShardDeployParameters) {
    let newStateInit = beginCell().storeShardedStateInit(self.deployParameters.init).endCell();
    let msg = beginCell()
        .storeUint(1, 2) // store tag = $0 and ihr_disabled = true
        .storeBool(self.deployParameters.bounce)
        .storeUint(1 << 10, 14) // store bounced = false and src = addr_none, addr_std$10, anycast: false, workchain = 0 (int8)
        .storeUint(changeShard(newStateInit.hash(), self.shard), 256) // addrHash
        .storeCoins(self.deployParameters.value)
        .storeUint(2 + 1, 1 + 4 + 4 + 64 + 32 + 1 + 1) // 1 + 4 + 4 + 64 + 32, stateInit: true, inRef: false
        .storeRef(newStateInit)
        .storeMaybeRef(self.deployParameters.body)
        .endCell();

    sendRawMessage(msg, self.deployParameters.mode);
}

extends inline fun send(self: ShardMessageParameters) {
    self.messageParameters.to = self.messageParameters.to.changeShard(self.shard);
    self.messageParameters.send();
}
