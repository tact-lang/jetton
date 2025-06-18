//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Core
//  Based on https://github.com/ton-blockchain/stablecoin-contract/blob/fcfe70f24bae671c24937243226508ec4bbd2bee/wrappers/JettonWallet.ts
//  Modified by TON Studio

import {Address, beginCell, Cell, ContractProvider, Sender, SendMode, toNano} from "@ton/core"

import {JettonWalletGovernance} from "../output/Governance_JettonWalletGovernance"

export type JettonWalletConfig = {
    ownerAddress: Address
    jettonMasterAddress: Address
}

export function jettonWalletConfigToCell(config: JettonWalletConfig): Cell {
    return beginCell()
        .storeUint(0, 4) // status
        .storeCoins(0) // jetton balance
        .storeAddress(config.ownerAddress)
        .storeAddress(config.jettonMasterAddress)
        .endCell()
}

export function parseJettonWalletData(data: Cell) {
    const sc = data.beginParse()
    return {
        status: sc.loadUint(4),
        balance: sc.loadCoins(),
        ownerAddress: sc.loadAddress(),
        jettonMasterAddress: sc.loadAddress(),
    }
}

export class ExtendedGovernanceJettonWallet extends JettonWalletGovernance {
    constructor(address: Address, init?: {code: Cell; data: Cell}) {
        super(address, init)
    }

    static async fromInit(status: bigint, balance: bigint, owner: Address, minter: Address) {
        const base = await JettonWalletGovernance.fromInit(status, balance, owner, minter)
        if (base.init === undefined) {
            throw new Error("GovernanceJettonWallet init is not defined")
        }
        return new ExtendedGovernanceJettonWallet(base.address, {
            code: base.init.code,
            data: base.init.data,
        })
    }

    static async createFromConfig(config: JettonWalletConfig, code: Cell, _workchain = 0) {
        return await this.fromInit(0n, 0n, config.ownerAddress, config.jettonMasterAddress)
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        })
    }

    async getWalletData(provider: ContractProvider) {
        const {stack} = await provider.get("get_wallet_data", [])
        return {
            balance: stack.readBigNumber(),
            owner: stack.readAddress(),
            minter: stack.readAddress(),
            wallet_code: stack.readCell(),
        }
    }
    async getJettonBalance(provider: ContractProvider) {
        const state = await provider.getState()
        if (state.state.type !== "active") {
            return 0n
        }
        const res = await provider.get("get_wallet_data", [])
        return res.stack.readBigNumber()
    }
    async getWalletStatus(provider: ContractProvider) {
        const state = await provider.getState()
        if (state.state.type !== "active") {
            return 0
        }
        const res = await provider.get("get_status", [])
        return res.stack.readNumber()
    }
    static transferMessage(
        jetton_amount: bigint,
        to: Address,
        responseAddress: Address | null,
        customPayload: Cell | null,
        forward_ton_amount: bigint,
        forwardPayload: Cell | null,
    ) {
        return beginCell()
            .storeUint(JettonWalletGovernance.opcodes.JettonTransfer, 32)
            .storeUint(0, 64) // op, queryId
            .storeCoins(jetton_amount)
            .storeAddress(to)
            .storeAddress(responseAddress)
            .storeMaybeRef(customPayload)
            .storeCoins(forward_ton_amount)
            .storeMaybeRef(forwardPayload)
            .endCell()
    }
    async sendTransfer(
        provider: ContractProvider,
        via: Sender,
        value: bigint,
        jetton_amount: bigint,
        to: Address,
        responseAddress: Address,
        customPayload: Cell | null,
        forward_ton_amount: bigint,
        forwardPayload: Cell | null,
    ) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: ExtendedGovernanceJettonWallet.transferMessage(
                jetton_amount,
                to,
                responseAddress,
                customPayload,
                forward_ton_amount,
                forwardPayload,
            ),
            value: value,
        })
    }
    /*
      burn#595f07bc query_id:uint64 amount:(VarUInteger 16)
                    response_destination:MsgAddress custom_payload:(Maybe ^Cell)
                    = InternalMsgBody;
    */
    static burnMessage(
        jetton_amount: bigint,
        responseAddress: Address | null,
        customPayload: Cell | null,
    ) {
        return beginCell()
            .storeUint(JettonWalletGovernance.opcodes.JettonBurn, 32)
            .storeUint(0, 64) // op, queryId
            .storeCoins(jetton_amount)
            .storeAddress(responseAddress)
            .storeMaybeRef(customPayload)
            .endCell()
    }

    async sendBurn(
        provider: ContractProvider,
        via: Sender,
        value: bigint,
        jetton_amount: bigint,
        responseAddress: Address | null,
        customPayload: Cell | null,
    ) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: ExtendedGovernanceJettonWallet.burnMessage(
                jetton_amount,
                responseAddress,
                customPayload,
            ),
            value: value,
        })
    }
    /*
      withdraw_tons#107c49ef query_id:uint64 = InternalMsgBody;
    */
    static withdrawTonsMessage() {
        return beginCell()
            .storeUint(0x6d8e5e3c, 32)
            .storeUint(0, 64) // op, queryId
            .endCell()
    }

    async sendWithdrawTons(provider: ContractProvider, via: Sender) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: ExtendedGovernanceJettonWallet.withdrawTonsMessage(),
            value: toNano("0.1"),
        })
    }
    /*
      withdraw_jettons#10 query_id:uint64 wallet:MsgAddressInt amount:Coins = InternalMsgBody;
    */
    static withdrawJettonsMessage(from: Address, amount: bigint) {
        return beginCell()
            .storeUint(0x768a50b2, 32)
            .storeUint(0, 64) // op, queryId
            .storeAddress(from)
            .storeCoins(amount)
            .storeMaybeRef(null)
            .endCell()
    }

    async sendWithdrawJettons(
        provider: ContractProvider,
        via: Sender,
        from: Address,
        amount: bigint,
    ) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: ExtendedGovernanceJettonWallet.withdrawJettonsMessage(from, amount),
            value: toNano("0.1"),
        })
    }
}
