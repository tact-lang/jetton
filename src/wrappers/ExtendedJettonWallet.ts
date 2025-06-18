//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Studio

import {
    ClaimTON,
    JettonTransfer,
    JettonWallet,
    walletStateInitCells,
    walletStateInitBits,
} from "../output/Jetton_JettonWallet"
import {Address, Builder, Cell, ContractProvider, Sender, toNano} from "@ton/core"
import {JettonBurn, ProvideWalletBalance} from "../output/Jetton_JettonMinter"

export class ExtendedJettonWallet extends JettonWallet {
    constructor(address: Address, init?: {code: Cell; data: Cell}) {
        super(address, init)
    }

    static async fromInit(owner: Address, minter: Address, balance: bigint) {
        const base = await JettonWallet.fromInit(owner, minter, balance)
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

    /**
     * Sends a Jetton transfer message from this wallet to a specified recipient.
     *
     * @param provider - The contract provider used to interact with the blockchain. Automatically passed by the test environment proxy
     * @param via - The sender object representing the wallet or account initiating the transfer.
     * @param value - The amount of TONs to attach to the transfer for fees and forwarding.
     * @param jettonAmount - The amount of Jettons to transfer.
     * @param to - The recipient address to which the Jettons will be sent.
     * @param responseAddress - The address to receive the response from the transfer operation (Jetton excesses)
     * @param customPayload - An optional custom payload to include in the transfer message.
     * @param forwardTonAmount - The amount of TONs to forward to the recipient along with the Jettons.
     * @param forwardPayload - An optional payload to include in the forwarded message to the recipient.
     *
     * @returns A promise that resolves when the transfer message has been sent, returns SendResult.
     *
     * @example
     * await jettonWallet.sendTransfer(
     *     provider,
     *     sender,
     *     toNano("0.05"),
     *     toNano("100"),
     *     recipientAddress,
     *     responseAddress,
     *     null,
     *     toNano("0.01"),
     *     null
     * );
     */
    sendTransfer = async (
        provider: ContractProvider,
        via: Sender,
        value: bigint,
        jettonAmount: bigint,
        to: Address,
        responseAddress: Address,
        customPayload: Cell | null,
        forwardTonAmount: bigint,
        forwardPayload: Cell | null,
    ): Promise<void> => {
        const parsedForwardPayload =
            forwardPayload != null
                ? forwardPayload.beginParse()
                : new Builder().storeUint(0, 1).endCell().beginParse()

        const msg: JettonTransfer = {
            $$type: "JettonTransfer",
            queryId: 0n,
            amount: jettonAmount,
            destination: to,
            responseDestination: responseAddress,
            customPayload: customPayload,
            forwardTonAmount: forwardTonAmount,
            forwardPayload: parsedForwardPayload,
        }

        await this.send(provider, via, {value}, msg)
    }

    sendBurn = async (
        provider: ContractProvider,
        via: Sender,
        value: bigint,
        jettonAmount: bigint,
        responseAddress: Address | null,
        customPayload: Cell | null,
    ): Promise<void> => {
        const msg: JettonBurn = {
            $$type: "JettonBurn",
            queryId: 0n,
            amount: jettonAmount,
            responseDestination: responseAddress,
            customPayload: customPayload,
        }

        await this.send(provider, via, {value}, msg)
    }

    sendProvideWalletBalance = async (
        provider: ContractProvider,
        via: Sender,
        value: bigint,
        receiver: Address,
        includeInfo: boolean,
    ): Promise<void> => {
        const msg: ProvideWalletBalance = {
            $$type: "ProvideWalletBalance",
            receiver: receiver,
            includeVerifyInfo: includeInfo,
        }

        await this.send(provider, via, {value}, msg)
    }

    async sendClaimTon(
        provider: ContractProvider,
        via: Sender,
        address: Address,
        value: bigint = toNano("0.1"),
    ): Promise<void> {
        const msg: ClaimTON = {
            $$type: "ClaimTON",
            receiver: address,
        }
        return this.send(provider, via, {value: value}, msg)
    }

    // for compatibility with the reference implementation tests
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

    loadWalletStateInitCells(): bigint {
        return walletStateInitCells
    }

    loadWalletStateInitBits(): bigint {
        return walletStateInitBits
    }
}
