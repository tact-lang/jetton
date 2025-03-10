import {JettonTransfer, JettonWallet} from "../output/Jetton_JettonWallet"
import {Address, Builder, Cell, ContractProvider, Sender} from "@ton/core"
import {JettonBurn} from "../output/Jetton_JettonMinter"

export class ExtendedJettonWallet extends JettonWallet {
    constructor(address: Address, init?: {code: Cell; data: Cell}) {
        super(address, init)
    }

    static async fromInit(balance: bigint, owner: Address, minter: Address) {
        const base = await JettonWallet.fromInit(balance, owner, minter)
        if (base.init === undefined) {
            throw new Error("JettonWallet init is not defined")
        }
        return new ExtendedJettonWallet(base.address, {code: base.init.code, data: base.init.data})
    }

    getJettonBalance = async (provider: ContractProvider): Promise<bigint> => {
        const state = await provider.getState()
        if (state.state.type !== "active") {
            return 0n
        }
        return (await this.getGetWalletData(provider)).balance
    }

    sendTransfer = async (
        provider: ContractProvider,
        via: Sender,
        value: bigint,
        jetton_amount: bigint,
        to: Address,
        responseAddress: Address,
        customPayload: Cell | null,
        forward_ton_amount: bigint,
        forwardPayload: Cell | null,
    ): Promise<void> => {
        const parsedForwardPayload =
            forwardPayload != null
                ? forwardPayload.beginParse()
                : new Builder().storeUint(0, 1).endCell().beginParse()

        const msg: JettonTransfer = {
            $$type: "JettonTransfer",
            queryId: 0n,
            amount: jetton_amount,
            destination: to,
            responseDestination: responseAddress,
            customPayload: customPayload,
            forwardTonAmount: forward_ton_amount,
            forwardPayload: parsedForwardPayload,
        }

        await this.send(provider, via, {value}, msg)
    }

    sendBurn = async (
        provider: ContractProvider,
        via: Sender,
        value: bigint,
        jetton_amount: bigint,
        responseAddress: Address | null,
        customPayload: Cell | null,
    ): Promise<void> => {
        const msg: JettonBurn = {
            $$type: "JettonBurn",
            queryId: 0n,
            amount: jetton_amount,
            responseDestination: responseAddress,
            customPayload: customPayload,
        }

        await this.send(provider, via, {value}, msg)
    }

    sendWithdrawTons = async (_provider: ContractProvider, _via: Sender): Promise<void> => {
        throw new Error("Not implemented")
    }

    sendWithdrawJettons = async (
        _provider: ContractProvider,
        _via: Sender,
        _from: Address,
        _amount: bigint,
    ): Promise<void> => {
        throw new Error("Not implemented")
    }
}
