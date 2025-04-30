import {
    JettonMinterFeatureRich,
    Mint,
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
            tonAmount: totalTonAmount,
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

    override loadMintMessage(mintAmount: bigint, deployerAddress: Address): Cell {
        return beginCell()
            .store(
                storeMint({
                    $$type: "Mint",
                    mintMessage: {
                        $$type: "JettonTransferInternalWithStateInit",
                        amount: mintAmount,
                        sender: deployerAddress,
                        responseDestination: deployerAddress,
                        queryId: 0n,
                        forwardTonAmount: 0n,
                        forwardStateInit: null,
                        forwardPayload: beginCell().storeUint(0, 1).asSlice(),
                    },
                    queryId: 0n,
                    receiver: deployerAddress,
                    tonAmount: mintAmount,
                }),
            )
            .endCell()
    }
}
