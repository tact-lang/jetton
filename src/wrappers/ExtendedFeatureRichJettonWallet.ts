import {Address, beginCell, Cell, ContractProvider, Sender} from "@ton/core"
import {ExtendedJettonWallet} from "./ExtendedJettonWallet"
import {JettonWalletFeatureRich} from "../output/FeatureRich_JettonWalletFeatureRich"

export class ExtendedFeatureRichJettonWallet extends ExtendedJettonWallet {
    constructor(address: Address, init?: {code: Cell; data: Cell}) {
        super(address, init)
    }

    static async fromInit(owner: Address, minter: Address, balance: bigint) {
        const base = await JettonWalletFeatureRich.fromInit(owner, minter, balance)
        if (base.init === undefined) {
            throw new Error("JettonWallet init is not defined")
        }
        return new ExtendedFeatureRichJettonWallet(base.address, {
            code: base.init.code,
            data: base.init.data,
        })
    }

    sendTransferWithJettonMode = async (
        provider: ContractProvider,
        via: Sender,
        value: bigint,
        amount: bigint,
        to: Address,
        responseAddress: Address,
        forwardTonAmount: bigint,
        forwardPayload: Cell | null,
        jettonSendMode: bigint,
    ) => {
        return await this.sendTransfer(
            provider,
            via,
            value,
            0n,
            to,
            responseAddress,
            beginCell().storeUint(jettonSendMode, 32).endCell(), // custom payload as mode
            forwardTonAmount,
            forwardPayload,
        )
    }
}
