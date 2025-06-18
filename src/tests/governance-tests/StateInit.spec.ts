//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Core
// https://github.com/ton-blockchain/stablecoin-contract/blob/fcfe70f24bae671c24937243226508ec4bbd2bee/sandbox_tests/StateInit.spec.ts

import {Blockchain, SandboxContract, TreasuryContract} from "@ton/sandbox"
import {Address, beginCell, Cell, Dictionary, storeStateInit, toNano} from "@ton/core"
import {
    ExtendedGovernanceJettonMinter,
    jettonContentToCell,
} from "../../wrappers/ExtendedGovernanceJettonMinter"
import {ExtendedGovernanceJettonWallet} from "../../wrappers/ExtendedGovernanceJettonWallet"

import "@ton/test-utils"
import {collectCellStats} from "./gasUtils"
import {Op} from "../../wrappers/GovernanceJettonConstants"

let blockchain: Blockchain
let deployer: SandboxContract<TreasuryContract>
let jettonMinter: SandboxContract<ExtendedGovernanceJettonMinter>
let minter_code: Cell
let _wallet_code: Cell
let jwallet_code_raw: Cell
let jwallet_code: Cell
let userWallet: (address: Address) => Promise<SandboxContract<ExtendedGovernanceJettonWallet>>

// This test set is copied from https://github.com/ton-blockchain/stablecoin-contract
describe("State init tests", () => {
    beforeAll(async () => {
        blockchain = await Blockchain.create()
        deployer = await blockchain.treasury("deployer")
        jwallet_code_raw = (
            await ExtendedGovernanceJettonWallet.fromInit(
                0n,
                0n,
                deployer.address,
                deployer.address,
            )
        ).init!.code
        minter_code = (
            await ExtendedGovernanceJettonMinter.fromInit(0n, deployer.address, null, new Cell())
        ).init!.code

        // jwallet_code is library
        const _libs = Dictionary.empty(Dictionary.Keys.BigUint(256), Dictionary.Values.Cell())
        _libs.set(BigInt(`0x${jwallet_code_raw.hash().toString("hex")}`), jwallet_code_raw)
        blockchain.libs = beginCell().storeDictDirect(_libs).endCell()
        const lib_prep = beginCell().storeUint(2, 8).storeBuffer(jwallet_code_raw.hash()).endCell()
        jwallet_code = new Cell({exotic: true, bits: lib_prep.bits, refs: lib_prep.refs})

        console.log("jetton minter code hash = ", minter_code.hash().toString("hex"))
        console.log("jetton wallet code hash = ", jwallet_code.hash().toString("hex"))

        jettonMinter = blockchain.openContract(
            await ExtendedGovernanceJettonMinter.createFromConfig(
                {
                    admin: deployer.address,
                    wallet_code: jwallet_code,
                    jetton_content: jettonContentToCell({uri: "https://ton.org/"}),
                },
                minter_code,
            ),
        )

        userWallet = async (address: Address) =>
            blockchain.openContract(
                new ExtendedGovernanceJettonWallet(await jettonMinter.getGetWalletAddress(address)),
            )
    })
    it("should deploy", async () => {
        // await blockchain.setVerbosityForAddress(jettonMinter.address, {blockchainLogs:true, vmLogs: 'vm_logs'});
        const deployResult = await jettonMinter.sendDeploy(deployer.getSender(), toNano("10"))

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: jettonMinter.address,
            deploy: true,
        })
        // Make sure it didn't bounce
        expect(deployResult.transactions).not.toHaveTransaction({
            on: deployer.address,
            from: jettonMinter.address,
            inMessageBounced: true,
        })
    })
    it("should mint max jetton value", async () => {
        const maxValue = 2n ** 120n - 1n
        const deployerWallet = await userWallet(deployer.address)
        const res = await jettonMinter.sendMint(
            deployer.getSender(),
            deployer.address,
            maxValue,
            null,
            null,
            null,
        )
        expect(res.transactions).toHaveTransaction({
            on: deployerWallet.address,
            op: Op.internal_transfer,
            success: true,
        })

        const curBalance = await deployerWallet.getJettonBalance()
        expect(curBalance).toEqual(maxValue)
        const smc = await blockchain.getContract(deployerWallet.address)
        if (smc.accountState === undefined) throw new Error("Can't access wallet account state")
        if (smc.accountState.type !== "active") throw new Error("Wallet account is not active")
        if (smc.account.account === undefined || smc.account.account === null)
            throw new Error("Can't access wallet account!")
        console.log("Jetton wallet max storage stats:", smc.account.account.storageStats.used)
        const state = smc.accountState.state
        const stateCell = beginCell().store(storeStateInit(state)).endCell()
        console.log("State init stats:", collectCellStats(stateCell, []))
    })
})
