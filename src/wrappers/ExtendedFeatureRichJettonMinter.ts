//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Studio

import {
    gasForBurn,
    gasForTransfer,
    JettonMinterFeatureRich,
    Mint,
    minTonsForStorage,
    storeMint,
} from "../output/FeatureRich_JettonMinterFeatureRich"
import {Address, beginCell, Cell, ContractProvider, Sender, toNano} from "@ton/core"
import {ExtendedJettonMinter} from "./ExtendedJettonMinter"

export class ExtendedFeatureRichJettonMinter extends ExtendedJettonMinter {
    constructor(address: Address, init?: {code: Cell; data: Cell}) {
        super(address, init)
    }

    static async fromInit(totalSupply: bigint, owner: Address, jettonContent: Cell) {
        const base = await JettonMinterFeatureRich.fromInit(totalSupply, owner, jettonContent, true)
        if (base.init === undefined) {
            throw new Error("JettonMinter init is not defined")
        }
        return new ExtendedFeatureRichJettonMinter(base.address, {
            code: base.init.code,
            data: base.init.data,
        })
    }

    override async sendMint(
        provider: ContractProvider,
        via: Sender,
        to: Address,
        jettonAmount: bigint,
        forwardTonAmount: bigint,
        totalTonAmount: bigint,
    ): Promise<void> {
        if (totalTonAmount <= forwardTonAmount) {
            throw new Error("Total TON amount should be greater than the forward amount")
        }
        const msg: Mint = {
            $$type: "Mint",
            queryId: 0n,
            receiver: to,
            mintMessage: {
                $$type: "JettonTransferInternalWithStateInit",
                queryId: 0n,
                amount: jettonAmount,
                sender: this.address,
                responseDestination: this.address,
                forwardTonAmount: forwardTonAmount,
                forwardStateInit: null,
                forwardPayload: beginCell().storeUint(0, 1).asSlice(),
            },
        }

        return via.send({
            to: this.address,
            value: totalTonAmount + toNano("0.015"),
            body: beginCell().store(storeMint(msg)).endCell(),
        })
    }

    override loadMintMessage(
        mintAmount: bigint,
        receiver: Address,
        sender: Address,
        responseDestination: Address,
        forwardTonAmount: bigint,
        forwardPayload: Cell | null,
    ): Cell {
        return beginCell()
            .store(
                storeMint({
                    $$type: "Mint",
                    mintMessage: {
                        $$type: "JettonTransferInternalWithStateInit",
                        amount: mintAmount,
                        sender: sender,
                        responseDestination: responseDestination,
                        queryId: 0n,
                        forwardTonAmount: forwardTonAmount,
                        forwardStateInit: null,
                        forwardPayload: beginCell().storeMaybeRef(forwardPayload).asSlice(),
                    },
                    queryId: 0n,
                    receiver: receiver,
                }),
            )
            .endCell()
    }

    override loadGasForBurn(): bigint {
        return gasForBurn
    }

    override loadGasForTransfer(): bigint {
        return gasForTransfer
    }

    override loadMinTonsForStorage(): bigint {
        return minTonsForStorage
    }
}
