//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Core
// https://github.com/ton-blockchain/stablecoin-contract/blob/fcfe70f24bae671c24937243226508ec4bbd2bee/sandbox_tests/JettonWallet.spec.ts

import {
    Blockchain,
    SandboxContract,
    TreasuryContract,
    internal,
    BlockchainSnapshot,
    SendMessageResult,
    BlockchainTransaction,
} from "@ton/sandbox"
import {
    Cell,
    toNano,
    beginCell,
    Address,
    Transaction,
    storeAccountStorage,
    Sender,
    Dictionary,
    storeMessage,
    fromNano,
    DictionaryValue,
    TransactionDescriptionGeneric,
    TransactionComputeVm,
} from "@ton/core"

import {Op} from "../../wrappers/GovernanceJettonConstants"
import {findTransactionRequired, flattenTransaction} from "@ton/test-utils"

import {
    randomAddress,
    getRandomTon,
    differentAddress,
    getRandomInt,
    testJettonTransfer,
    testJettonInternalTransfer,
    testJettonNotification,
    testJettonBurnNotification,
} from "./utils"

import {
    calcStorageFee,
    collectCellStats,
    computeFwdFees,
    computeFwdFeesVerbose,
    computeGasFee,
    FullFees,
    GasPrices,
    getGasPrices,
    getMsgPrices,
    getStoragePrices,
    computedGeneric,
    storageGeneric,
    MsgPrices,
    setGasPrice,
    setMsgPrices,
    setStoragePrices,
    StorageStats,
    StorageValue,
} from "./gasUtils"
import {sha256} from "@ton/crypto"
import {
    ExtendedGovernanceJettonMinter,
    jettonContentToCell,
} from "../../wrappers/ExtendedGovernanceJettonMinter"
import {ExtendedGovernanceJettonWallet} from "../../wrappers/ExtendedGovernanceJettonWallet"
import {gasForBurn, gasForTransfer} from "../../output/Governance_GovernanceJettonMinter"

import {storeBigPayload} from "../../utils/utils"
import {
    walletStateInitBits,
    walletStateInitCells,
} from "../../output/Governance_JettonWalletGovernance"

type JettonMinterContent = {
    uri: string
}
type LockType = "unlock" | "out" | "in" | "full"

/*
   These tests check compliance with the TEP-74 and TEP-89,
   but also checks some implementation details.
   If you want to keep only TEP-74 and TEP-89 compliance tests,
   you need to remove/modify the following tests:
     mint tests (since minting is not covered by standard)
     exit_codes
     prove pathway
*/

// jetton params

let send_gas_fee: bigint
let _send_fwd_fee: bigint
let receive_gas_fee: bigint
let burn_gas_fee: bigint
let burn_notification_fee: bigint
let min_tons_for_storage: bigint

function _printTransactions(txs: Transaction[]) {
    for (const tx of txs) {
        console.log(flattenTransaction(tx))
    }
}

describe("JettonWallet", () => {
    let jwallet_code_raw = new Cell() // true code
    let jwallet_code = new Cell() // library cell with reference to jwallet_code_raw
    let minter_code = new Cell()
    let blockchain: Blockchain
    let deployer: SandboxContract<TreasuryContract>
    let notDeployer: SandboxContract<TreasuryContract>
    let jettonMinter: SandboxContract<ExtendedGovernanceJettonMinter>
    let userWallet: (address: Address) => Promise<SandboxContract<ExtendedGovernanceJettonWallet>>
    let walletStats: StorageStats
    let msgPrices: MsgPrices
    let gasPrices: GasPrices
    let storagePrices: StorageValue
    let storageDuration: number
    let stateInitStats: StorageStats
    let defaultOverhead: bigint
    let defaultContent: JettonMinterContent

    let printTxGasStats: (name: string, trans: Transaction) => bigint
    let estimateBodyFee: (body: Cell, force_ref: boolean, prices?: MsgPrices) => FullFees
    let estimateBurnFwd: (prices?: MsgPrices) => bigint
    let forwardOverhead: (prices: MsgPrices, stats: StorageStats) => bigint
    let estimateAdminTransferFwd: (
        amount: bigint,
        custom_payload: Cell | null,
        forward_amount: bigint,
        forward_payload: Cell | null,
        prices?: MsgPrices,
    ) => bigint
    let estimateTransferFwd: (
        amount: bigint,
        fwd_amount: bigint,
        fwd_payload: Cell | null,
        custom_payload: Cell | null,
        prices?: MsgPrices,
    ) => bigint
    let calcSendFees: (
        send_fee: bigint,
        recv_fee: bigint,
        fwd_fee: bigint,
        fwd_amount: bigint,
        storage_fee: bigint,
        state_init?: bigint,
    ) => bigint
    let testBurnFees: (
        fees: bigint,
        to: Address,
        amount: bigint,
        exp: number,
        custom: Cell | null,
        prices?: MsgPrices,
    ) => Promise<Array<BlockchainTransaction>>
    let testSendFees: (
        fees: bigint,
        fwd_amount: bigint,
        fwd: Cell | null,
        custom: Cell | null,
        exp: boolean,
    ) => Promise<void>
    let testAdminTransfer: (
        ton_amount: bigint,
        transfer_amount: bigint,
        from: Address,
        fwd_amount: bigint,
        fwd: Cell | null,
        custom: Cell | null,
        exp: number,
    ) => Promise<void>
    let testAdminBurn: (
        ton_amount: bigint,
        burn_amount: bigint,
        burn_addr: Address,
        response: Address,
        custom_payload: Cell | null,
        exp: number,
    ) => Promise<Array<BlockchainTransaction>>

    beforeAll(async () => {
        blockchain = await Blockchain.create()
        // blockchain.verbosity.vmLogs = "vm_logs_verbose";
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
        notDeployer = await blockchain.treasury("notDeployer")
        walletStats = new StorageStats(walletStateInitBits, walletStateInitCells)
        msgPrices = getMsgPrices(blockchain.config, 0)
        gasPrices = getGasPrices(blockchain.config, 0)
        storagePrices = getStoragePrices(blockchain.config)
        storageDuration = 5 * 365 * 24 * 3600
        stateInitStats = new StorageStats(931, 3)
        defaultContent = {
            uri: "https://some_stablecoin.org/meta.json",
        }

        // jwallet_code is library
        const _libs = Dictionary.empty(Dictionary.Keys.BigUint(256), Dictionary.Values.Cell())
        _libs.set(BigInt(`0x${jwallet_code_raw.hash().toString("hex")}`), jwallet_code_raw)
        const libs = beginCell().storeDictDirect(_libs).endCell()
        blockchain.libs = libs
        const lib_prep = beginCell().storeUint(2, 8).storeBuffer(jwallet_code_raw.hash()).endCell()
        jwallet_code = new Cell({exotic: true, bits: lib_prep.bits, refs: lib_prep.refs})

        console.log("jetton minter code hash = ", minter_code.hash().toString("hex"))
        console.log("jetton wallet code hash = ", jwallet_code.hash().toString("hex"))
        blockchain.now = Math.floor(Date.now() / 1000)

        jettonMinter = blockchain.openContract(
            await ExtendedGovernanceJettonMinter.createFromConfig(
                {
                    admin: deployer.address,
                    wallet_code: jwallet_code,
                    jetton_content: jettonContentToCell(defaultContent),
                },
                minter_code,
            ),
        )
        userWallet = async (address: Address) =>
            blockchain.openContract(
                new ExtendedGovernanceJettonWallet(await jettonMinter.getGetWalletAddress(address)),
            )

        printTxGasStats = (name, transaction) => {
            const txComputed = computedGeneric(transaction)
            console.log(`${name} used ${txComputed.gasUsed} gas`)
            console.log(`${name} gas cost: ${txComputed.gasFees}`)
            return txComputed.gasFees
        }

        estimateBodyFee = (body, force_ref, prices) => {
            const _curPrice = prices || msgPrices
            const mockAddr = new Address(0, Buffer.alloc(32, "A"))
            const testMsg = internal({
                from: mockAddr,
                to: mockAddr,
                value: toNano("1"),
                body,
            })
            const packed = beginCell()
                .store(storeMessage(testMsg, {forceRef: force_ref}))
                .endCell()
            const stats = collectCellStats(packed, [], true)
            return computeFwdFeesVerbose(prices || msgPrices, stats.cells, stats.bits)
        }
        estimateBurnFwd = prices => {
            const curPrices = prices || msgPrices
            return computeFwdFees(curPrices, 1n, 754n)
        }
        forwardOverhead = (prices, stats) => {
            // Meh, kinda lazy way of doing that, but tests are bloated enough already
            return computeFwdFees(prices, stats.cells, stats.bits) - prices.lumpPrice
        }
        estimateAdminTransferFwd = (
            jetton_amount,
            custom_payload,
            forward_amount,
            forward_payload,
            prices,
        ) => {
            const mockAddr = randomAddress(0)
            const curPrices = prices || msgPrices
            const body = ExtendedGovernanceJettonMinter.forceTransferMessage(
                jetton_amount,
                mockAddr,
                mockAddr,
                custom_payload,
                forward_amount,
                forward_payload,
            )
            const estimate = estimateBodyFee(body, false, curPrices)
            const reverse = (estimate.remaining * 65536n) / (65536n - curPrices.firstFrac)
            expect(reverse).toBeGreaterThanOrEqual(estimate.total)
            return reverse
        }
        estimateTransferFwd = (jetton_amount, fwd_amount, fwd_payload, custom_payload, prices) => {
            // Purpose is to account for the first biggest one fwd fee.
            // So, we use fwd_amount here only for body calculation

            const mockFrom = randomAddress(0)
            const mockTo = randomAddress(0)

            const body = ExtendedGovernanceJettonWallet.transferMessage(
                jetton_amount,
                mockTo,
                mockFrom,
                custom_payload,
                fwd_amount,
                fwd_payload,
            )

            const curPrices = prices || msgPrices
            const feesRes = estimateBodyFee(body, true, curPrices)
            const reverse = (feesRes.remaining * 65536n) / (65536n - curPrices.firstFrac)
            expect(reverse).toBeGreaterThanOrEqual(feesRes.total)
            return reverse
        }

        calcSendFees = (send, recv, fwd, fwd_amount, storage, state_init) => {
            const overhead = state_init || defaultOverhead
            const fwdTotal = fwd_amount + (fwd_amount > 0n ? fwd * 2n : fwd) + overhead
            const _execute = send + recv
            return BigInt(fwdTotal) + BigInt(send) + BigInt(recv) + BigInt(storage) + 1n
        }

        testBurnFees = async (fees, to, amount, exp, custom_payload, prices) => {
            const burnWallet = await userWallet(deployer.address)
            const initialJettonBalance = await burnWallet.getJettonBalance()
            const initialTotalSupply = await jettonMinter.getTotalSupply()
            const burnTxs: Array<BlockchainTransaction> = []
            const burnBody = ExtendedGovernanceJettonWallet.burnMessage(amount, to, custom_payload)
            const _minterSender = blockchain.sender(jettonMinter.address)
            const sendRes = await blockchain.sendMessage(
                internal({
                    from: jettonMinter.address,
                    to: burnWallet.address,
                    value: fees,
                    forwardFee: estimateBodyFee(burnBody, false, prices || msgPrices).remaining,
                    body: burnBody,
                }),
            )
            if (exp == 0) {
                burnTxs.push(
                    findTransactionRequired(sendRes.transactions, {
                        on: burnWallet.address,
                        from: jettonMinter.address,
                        op: Op.burn,
                        success: true,
                    }),
                )
                // We expect burn to succeed, but no excess
                burnTxs.push(
                    findTransactionRequired(sendRes.transactions, {
                        on: jettonMinter.address,
                        from: burnWallet.address,
                        op: Op.burn_notification,
                        success: true,
                    })!,
                )

                expect(await burnWallet.getJettonBalance()).toEqual(initialJettonBalance - amount)
                expect(await jettonMinter.getTotalSupply()).toEqual(initialTotalSupply - amount)
            } else {
                expect(sendRes.transactions).toHaveTransaction({
                    on: burnWallet.address,
                    from: jettonMinter.address,
                    op: Op.burn,
                    success: false,
                    exitCode: exp,
                })
                expect(sendRes.transactions).not.toHaveTransaction({
                    on: jettonMinter.address,
                    from: burnWallet.address,
                    op: Op.burn_notification,
                })
                expect(await burnWallet.getJettonBalance()).toEqual(initialJettonBalance)
                expect(await jettonMinter.getTotalSupply()).toEqual(initialTotalSupply)
            }

            return burnTxs
        }
        testSendFees = async (fees, fwd_amount, fwd_payload, custom_payload, exp) => {
            const deployerJettonWallet = await userWallet(deployer.address)
            const initialJettonBalance = await deployerJettonWallet.getJettonBalance()
            const someUserAddr = randomAddress(0)
            const someWallet = await userWallet(someUserAddr)

            const jettonAmount = 1n
            const sendResult = await deployerJettonWallet.sendTransfer(
                deployer.getSender(),
                fees,
                jettonAmount,
                someUserAddr,
                deployer.address,
                custom_payload,
                fwd_amount,
                fwd_payload,
            )

            if (exp) {
                expect(sendResult.transactions).toHaveTransaction({
                    on: someWallet.address,
                    op: Op.internal_transfer,
                    success: true,
                })
                if (fwd_amount > 0n) {
                    expect(sendResult.transactions).toHaveTransaction({
                        on: someUserAddr,
                        from: someWallet.address,
                        op: Op.transfer_notification,
                        body: x => {
                            if (fwd_payload === null) {
                                return true
                            }
                            return x!.beginParse().preloadRef().equals(fwd_payload)
                        },
                        // We do not test for success, because receiving contract would be uninitialized
                    })
                }
                expect(await deployerJettonWallet.getJettonBalance()).toEqual(
                    initialJettonBalance - jettonAmount,
                )
                expect(await someWallet.getJettonBalance()).toEqual(jettonAmount)
            } else {
                expect(sendResult.transactions).toHaveTransaction({
                    on: deployerJettonWallet.address,
                    from: deployer.address,
                    op: Op.transfer,
                    aborted: true,
                    success: false,
                    exitCode:
                        ExtendedGovernanceJettonMinter.errors[
                            "Insufficient amount of TON attached"
                        ],
                })
                expect(sendResult.transactions).not.toHaveTransaction({
                    on: someWallet.address,
                })
            }
        }
        testAdminTransfer = async (
            ton_amount,
            jetton_amount,
            from,
            fwd_amount,
            fwd,
            custom,
            exp,
        ) => {
            const to = randomAddress(0)
            const srcWallet = await userWallet(from)
            const dstWallet = await userWallet(to)
            const initialFromBalance = await srcWallet.getJettonBalance()
            const initialToBalance = await dstWallet.getJettonBalance()

            const sendResult = await jettonMinter.sendForceTransfer(
                deployer.getSender(),
                jetton_amount,
                to,
                from,
                custom,
                fwd_amount,
                fwd,
                ton_amount,
            )
            expect(sendResult.transactions).toHaveTransaction({
                on: jettonMinter.address,
                from: deployer.address,
                op: Op.call_to,
                success: exp == 0,
                exitCode: exp,
            })
            if (exp == 0) {
                expect(sendResult.transactions).toHaveTransaction({
                    on: srcWallet.address,
                    from: jettonMinter.address,
                    op: Op.transfer,
                    body: x =>
                        testJettonTransfer(x!, {
                            amount: jetton_amount,
                        }),
                    success: true,
                })
                if (fwd_amount > 0n) {
                    expect(sendResult.transactions).toHaveTransaction({
                        on: to,
                        op: Op.transfer_notification,
                        body: x =>
                            testJettonNotification(x!, {
                                amount: jetton_amount,
                            }),
                    })
                }

                expect(await srcWallet.getJettonBalance()).toEqual(
                    initialFromBalance - jetton_amount,
                )

                expect(await dstWallet.getJettonBalance()).toEqual(initialToBalance + jetton_amount)
            } else {
                expect(sendResult.transactions).not.toHaveTransaction({
                    on: dstWallet.address,
                    from: srcWallet.address,
                    op: Op.transfer,
                })

                expect(await srcWallet.getJettonBalance()).toEqual(initialFromBalance)
                expect(await dstWallet.getJettonBalance()).toEqual(initialToBalance)
            }
        }
        testAdminBurn = async (
            ton_amount,
            burn_amount,
            burn_addr,
            response_addr,
            custom_payload,
            exp,
        ) => {
            const burnWallet = await userWallet(burn_addr)

            const balanceBefore = await burnWallet.getJettonBalance()
            const supplyBefore = await jettonMinter.getTotalSupply()

            const res = await jettonMinter.sendForceBurn(
                deployer.getSender(),
                burn_amount,
                burn_addr,
                response_addr,
                ton_amount,
            )
            const burnTxs: Array<BlockchainTransaction> = []
            expect(res.transactions).toHaveTransaction({
                from: deployer.address,
                on: jettonMinter.address,
                op: Op.call_to,
                success: exp == 0,
                exitCode: exp,
            })

            if (exp == 0) {
                burnTxs.push(
                    findTransactionRequired(res.transactions, {
                        on: burnWallet.address,
                        from: jettonMinter.address,
                        op: Op.burn,
                        value: ton_amount,
                        success: true,
                    }),
                )

                burnTxs.push(
                    findTransactionRequired(res.transactions, {
                        on: jettonMinter.address,
                        from: burnWallet.address,
                        op: Op.burn_notification,
                        body: x =>
                            testJettonBurnNotification(x!, {
                                amount: burn_amount,
                                response_address: response_addr,
                            }),
                        success: true,
                    }),
                )
                /*
                expect(res.transactions).toHaveTransaction({
                    on: deployer.address,
                    from: jettonMinter.address,
                    op: Op.excesses,
                    success: true
                });
                */

                expect(await burnWallet.getJettonBalance()).toEqual(balanceBefore - burn_amount)
                expect(await jettonMinter.getTotalSupply()).toEqual(supplyBefore - burn_amount)
            } else {
                expect(res.transactions).not.toHaveTransaction({
                    on: jettonMinter.address,
                    from: burnWallet.address,
                    op: Op.burn_notification,
                })
                expect(await burnWallet.getJettonBalance()).toEqual(balanceBefore)
                expect(await jettonMinter.getTotalSupply()).toEqual(supplyBefore)
            }
            return burnTxs
        }

        defaultOverhead = forwardOverhead(msgPrices, stateInitStats)
    })

    // implementation detail
    it("should deploy", async () => {
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
    // implementation detail
    it("minter admin should be able to mint jettons", async () => {
        // can mint from deployer
        let initialTotalSupply = await jettonMinter.getTotalSupply()
        const deployerJettonWallet = await userWallet(deployer.address)
        const initialJettonBalance = toNano("1000.23")
        const mintResult = await jettonMinter.sendMint(
            deployer.getSender(),
            deployer.address,
            initialJettonBalance,
            null,
            null,
            null,
            toNano("0.05"),
            toNano("1"),
        )

        const mintTx = findTransactionRequired(mintResult.transactions, {
            from: jettonMinter.address,
            to: deployerJettonWallet.address,
            deploy: true,
            success: true,
        })

        printTxGasStats("Mint transaction:", mintTx)
        /*
		 * No excess in this jetton
        expect(mintResult.transactions).toHaveTransaction({ // excesses
            from: deployerJettonWallet.address,
            to: jettonMinter.address
        });
		*/

        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance)
        expect(await jettonMinter.getTotalSupply()).toEqual(
            initialTotalSupply + initialJettonBalance,
        )
        initialTotalSupply += initialJettonBalance
        // can mint from deployer again
        const additionalJettonBalance = toNano("2.31")
        await jettonMinter.sendMint(
            deployer.getSender(),
            deployer.address,
            additionalJettonBalance,
            null,
            null,
            null,
            toNano("0.05"),
            toNano("1"),
        )
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(
            initialJettonBalance + additionalJettonBalance,
        )
        expect(await jettonMinter.getTotalSupply()).toEqual(
            initialTotalSupply + additionalJettonBalance,
        )
        initialTotalSupply += additionalJettonBalance
        // can mint to other address
        const otherJettonBalance = toNano("3.12")
        await jettonMinter.sendMint(
            deployer.getSender(),
            notDeployer.address,
            otherJettonBalance,
            null,
            null,
            null,
            toNano("0.05"),
            toNano("1"),
        )
        const notDeployerJettonWallet = await userWallet(notDeployer.address)
        expect(await notDeployerJettonWallet.getJettonBalance()).toEqual(otherJettonBalance)
        expect(await jettonMinter.getTotalSupply()).toEqual(initialTotalSupply + otherJettonBalance)
    })

    // implementation detail
    it("not a minter admin should not be able to mint jettons", async () => {
        const initialTotalSupply = await jettonMinter.getTotalSupply()
        const deployerJettonWallet = await userWallet(deployer.address)
        const initialJettonBalance = await deployerJettonWallet.getJettonBalance()
        const unAuthMintResult = await jettonMinter.sendMint(
            notDeployer.getSender(),
            deployer.address,
            toNano("777"),
            null,
            null,
            null,
            toNano("0.05"),
            toNano("1"),
        )

        expect(unAuthMintResult.transactions).toHaveTransaction({
            from: notDeployer.address,
            to: jettonMinter.address,
            aborted: true,
            exitCode: ExtendedGovernanceJettonMinter.errors["Incorrect sender"], // error::unauthorized_mint_request
        })
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance)
        expect(await jettonMinter.getTotalSupply()).toEqual(initialTotalSupply)
    })

    it("minter admin can change admin", async () => {
        const adminBefore = await jettonMinter.getAdminAddress()
        expect(adminBefore).toEqualAddress(deployer.address)
        let res = await jettonMinter.sendChangeAdmin(deployer.getSender(), notDeployer.address)
        expect(res.transactions).toHaveTransaction({
            from: deployer.address,
            on: jettonMinter.address,
            success: true,
        })

        res = await jettonMinter.sendClaimAdmin(notDeployer.getSender())

        expect(res.transactions).toHaveTransaction({
            from: notDeployer.address,
            on: jettonMinter.address,
            success: true,
        })

        const adminAfter = await jettonMinter.getAdminAddress()
        expect(adminAfter).toEqualAddress(notDeployer.address)
        await jettonMinter.sendChangeAdmin(notDeployer.getSender(), deployer.address)
        await jettonMinter.sendClaimAdmin(deployer.getSender())
        expect((await jettonMinter.getAdminAddress()).equals(deployer.address)).toBe(true)
    })
    it("not a minter admin can not change admin", async () => {
        const adminBefore = await jettonMinter.getAdminAddress()
        expect(adminBefore).toEqualAddress(deployer.address)
        const changeAdmin = await jettonMinter.sendChangeAdmin(
            notDeployer.getSender(),
            notDeployer.address,
        )
        expect((await jettonMinter.getAdminAddress()).equals(deployer.address)).toBe(true)
        expect(changeAdmin.transactions).toHaveTransaction({
            from: notDeployer.address,
            on: jettonMinter.address,
            aborted: true,
            exitCode: ExtendedGovernanceJettonMinter.errors["Incorrect sender"], // error::unauthorized_change_admin_request
        })
    })
    it("only address specified in change admin action should be able to claim admin", async () => {
        const adminBefore = await jettonMinter.getAdminAddress()
        expect(adminBefore).toEqualAddress(deployer.address)
        let changeAdmin = await jettonMinter.sendChangeAdmin(
            deployer.getSender(),
            notDeployer.address,
        )
        expect(changeAdmin.transactions).toHaveTransaction({
            from: deployer.address,
            on: jettonMinter.address,
            success: true,
        })

        // At this point transfer_admin is set to notDeployer.address
        const sneaky = differentAddress(notDeployer.address)
        changeAdmin = await jettonMinter.sendClaimAdmin(blockchain.sender(sneaky))
        expect(changeAdmin.transactions).toHaveTransaction({
            from: sneaky,
            on: jettonMinter.address,
            success: false,
            aborted: true,
        })
    })

    describe.skip("Content tests", () => {
        const newContent: JettonMinterContent = {
            uri: `https://some_super_l${Buffer.alloc(200, "0")}ng_stable.org/`,
        }
        const snakeString: DictionaryValue<string> = {
            serialize: function (src, builder) {
                builder.storeUint(0, 8).storeStringTail(src)
            },
            parse: function (src) {
                const outStr = src.loadStringTail()
                if (outStr.charCodeAt(0) !== 0) {
                    throw new Error("No snake prefix")
                }
                return outStr.substr(1)
            },
        }
        const loadContent = (data: Cell) => {
            const ds = data.beginParse()
            expect(ds.loadUint(8)).toEqual(0)
            const content = ds.loadDict(Dictionary.Keys.Buffer(32), snakeString)
            expect(ds.remainingBits == 0 && ds.remainingRefs == 0).toBe(true)
            return content
        }

        it("minter admin can change content", async () => {
            const oldContent = loadContent(await jettonMinter.getContent())
            expect(oldContent.get(await sha256("uri"))! === defaultContent.uri).toBe(true)
            expect(oldContent.get(await sha256("decimals"))! === "6").toBe(true)
            let changeContent = await jettonMinter.sendChangeContent(
                deployer.getSender(),
                newContent,
            )
            expect(changeContent.transactions).toHaveTransaction({
                on: jettonMinter.address,
                from: deployer.address,
                op: Op.change_metadata_url,
                success: true,
            })
            let contentUpd = loadContent(await jettonMinter.getContent())
            expect(contentUpd.get(await sha256("uri"))! == newContent.uri).toBe(true)
            // Update back;
            changeContent = await jettonMinter.sendChangeContent(
                deployer.getSender(),
                defaultContent,
            )
            contentUpd = loadContent(await jettonMinter.getContent())
            expect(oldContent.get(await sha256("uri"))! === defaultContent.uri).toBe(true)
            expect(oldContent.get(await sha256("decimals"))! === "6").toBe(true)
        })
        it("not a minter admin can not change content", async () => {
            const oldContent = loadContent(await jettonMinter.getContent())
            const changeContent = await jettonMinter.sendChangeContent(
                notDeployer.getSender(),
                newContent,
            )
            expect(oldContent.get(await sha256("uri"))).toEqual(defaultContent.uri)
            expect(oldContent.get(await sha256("decimals"))).toEqual("6")

            expect(changeContent.transactions).toHaveTransaction({
                from: notDeployer.address,
                to: jettonMinter.address,
                aborted: true,
                exitCode: ExtendedGovernanceJettonMinter.errors["Not owner"],
            })
        })
    })

    it("storage stats", async () => {
        const prev = blockchain.snapshot()

        const deployerJettonWallet = await userWallet(deployer.address)
        const smc = await blockchain.getContract(deployerJettonWallet.address)
        const actualStats = collectCellStats(
            beginCell().store(storeAccountStorage(smc.account.account!.storage)).endCell(),
            [],
        )
        console.log("Jetton wallet actual storage stats:", actualStats)
        expect(walletStats.cells).toBeGreaterThanOrEqual(actualStats.cells)
        expect(walletStats.bits).toBeGreaterThanOrEqual(actualStats.bits)
        console.log("Jetton estimated max storage stats:", walletStats)
        blockchain.now = blockchain.now! + storageDuration
        const res = await deployerJettonWallet.sendBurn(
            deployer.getSender(),
            toNano("1"),
            0n,
            null,
            null,
        )
        const _storagePhase = storageGeneric(res.transactions[1])
        // min_tons_for_storage = storagePhase.storageFeesCollected;
        min_tons_for_storage = calcStorageFee(storagePrices, walletStats, BigInt(storageDuration))
        await blockchain.loadFrom(prev)
    })
    it("wallet owner should be able to send jettons", async () => {
        const deployerJettonWallet = await userWallet(deployer.address)
        const initialJettonBalance = await deployerJettonWallet.getJettonBalance()
        const initialTotalSupply = await jettonMinter.getTotalSupply()
        const notDeployerJettonWallet = await userWallet(notDeployer.address)
        const balanceBefore = (await blockchain.getContract(notDeployerJettonWallet.address))
            .balance
        const initialJettonBalance2 = await notDeployerJettonWallet.getJettonBalance()
        const sentAmount = toNano("0.5")
        const forwardAmount = toNano("0.05")
        const sendResult = await deployerJettonWallet.sendTransfer(
            deployer.getSender(),
            toNano("0.17"), // tons
            sentAmount,
            notDeployer.address,
            deployer.address,
            null,
            forwardAmount,
            null,
        )
        expect(sendResult.transactions).toHaveTransaction({
            // excesses
            on: deployer.address,
            from: notDeployerJettonWallet.address,
            op: Op.excesses,
            success: true,
        })

        expect(sendResult.transactions).toHaveTransaction({
            // notification
            from: notDeployerJettonWallet.address,
            to: notDeployer.address,
            value: forwardAmount,
        })

        const balanceAfter = (await blockchain.getContract(notDeployerJettonWallet.address)).balance
        // Make sure we're not draining balance
        expect(balanceAfter).toBeGreaterThanOrEqual(balanceBefore)
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(
            initialJettonBalance - sentAmount,
        )
        expect(await notDeployerJettonWallet.getJettonBalance()).toEqual(
            initialJettonBalance2 + sentAmount,
        )
        expect(await jettonMinter.getTotalSupply()).toEqual(initialTotalSupply)
    })

    it("not wallet owner should not be able to send jettons", async () => {
        const deployerJettonWallet = await userWallet(deployer.address)
        const initialJettonBalance = await deployerJettonWallet.getJettonBalance()
        const initialTotalSupply = await jettonMinter.getTotalSupply()
        const notDeployerJettonWallet = await userWallet(notDeployer.address)
        const initialJettonBalance2 = await notDeployerJettonWallet.getJettonBalance()
        const sentAmount = toNano("0.5")
        const sendResult = await deployerJettonWallet.sendTransfer(
            notDeployer.getSender(),
            toNano("0.1"), // tons
            sentAmount,
            notDeployer.address,
            deployer.address,
            null,
            toNano("0.05"),
            null,
        )
        expect(sendResult.transactions).toHaveTransaction({
            from: notDeployer.address,
            to: deployerJettonWallet.address,
            aborted: true,
            exitCode: ExtendedGovernanceJettonMinter.errors["Incorrect sender"], // error::unauthorized_transfer
        })
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance)
        expect(await notDeployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance2)
        expect(await jettonMinter.getTotalSupply()).toEqual(initialTotalSupply)
    })

    it("impossible to send too much jettons", async () => {
        const deployerJettonWallet = await userWallet(deployer.address)
        const initialJettonBalance = await deployerJettonWallet.getJettonBalance()
        const notDeployerJettonWallet = await userWallet(notDeployer.address)
        const initialJettonBalance2 = await notDeployerJettonWallet.getJettonBalance()
        const sentAmount = initialJettonBalance + 1n
        const forwardAmount = toNano("0.05")
        const sendResult = await deployerJettonWallet.sendTransfer(
            deployer.getSender(),
            toNano("0.1"), // tons
            sentAmount,
            notDeployer.address,
            deployer.address,
            null,
            forwardAmount,
            null,
        )
        expect(sendResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: deployerJettonWallet.address,
            aborted: true,
            exitCode: ExtendedGovernanceJettonMinter.errors["Incorrect balance after send"], // error::not_enough_jettons
        })
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance)
        expect(await notDeployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance2)
    })

    describe("Malformed transfer", () => {
        let sendTransferPayload: (
            from: Address,
            to: Address,
            payload: Cell,
        ) => Promise<SendMessageResult>
        let assertFailTransfer: <T extends Transaction>(
            from: Address,
            to: Address,
            txs: Array<T>,
            codes: Array<number>,
        ) => void
        beforeAll(() => {
            sendTransferPayload = async (from, to, payload) => {
                return await blockchain.sendMessage(
                    internal({
                        from,
                        to,
                        body: payload,
                        value: toNano("1"),
                    }),
                )
            }
            assertFailTransfer = (from, to, txs, codes) => {
                expect(txs).toHaveTransaction({
                    on: to,
                    from,
                    aborted: true,
                    success: false,
                    exitCode: c => codes.includes(c!),
                })
                expect(txs).not.toHaveTransaction({
                    from: to,
                    op: Op.internal_transfer,
                })
            }
        })
        it("malformed custom payload", async () => {
            const deployerJettonWallet = await userWallet(deployer.address)
            const _notDeployerJettonWallet = await userWallet(notDeployer.address)

            const sentAmount = toNano("0.5")
            const forwardPayload = beginCell()
                .storeUint(getRandomInt(100000, 200000), 128)
                .endCell()
            const customPayload = beginCell().storeUint(getRandomInt(100000, 200000), 128).endCell()

            const forwardTail = beginCell().storeCoins(toNano("0.05")).storeMaybeRef(forwardPayload)
            const msgTemplate = beginCell()
                .storeUint(0xf8a7ea5, 32)
                .storeUint(0, 64) // op, queryId
                .storeCoins(sentAmount)
                .storeAddress(notDeployer.address)
                .storeAddress(deployer.address)
            let testPayload = beginCell()
                .storeBuilder(msgTemplate)
                .storeBit(true)
                .storeBuilder(forwardTail)
                .endCell()

            const errCodes = [9]
            let res = await sendTransferPayload(
                deployer.address,
                deployerJettonWallet.address,
                testPayload,
            )
            assertFailTransfer(
                deployer.address,
                deployerJettonWallet.address,
                res.transactions,
                errCodes,
            )

            testPayload = beginCell()
                .storeBuilder(msgTemplate)
                .storeBit(false)
                .storeRef(customPayload)
                .storeBuilder(forwardTail)
                .endCell()
            res = await sendTransferPayload(
                deployer.address,
                deployerJettonWallet.address,
                testPayload,
            )
            assertFailTransfer(
                deployer.address,
                deployerJettonWallet.address,
                res.transactions,
                errCodes,
            )
            // Now self test that we didn't screw the payloads ourselves
            testPayload = beginCell()
                .storeBuilder(msgTemplate)
                .storeBit(true)
                .storeRef(customPayload)
                .storeBuilder(forwardTail)
                .endCell()

            res = await sendTransferPayload(
                deployer.address,
                deployerJettonWallet.address,
                testPayload,
            )

            expect(res.transactions).toHaveTransaction({
                on: deployerJettonWallet.address,
                from: deployer.address,
                op: Op.transfer,
                success: true,
            })
        })
        it("malformed forward payload", async () => {
            const deployerJettonWallet = await userWallet(deployer.address)
            const _notDeployerJettonWallet = await userWallet(notDeployer.address)

            const sentAmount = toNano("0.5")
            const _forwardAmount = getRandomTon(0.01, 0.05) // toNano('0.05');
            const forwardPayload = beginCell().storeUint(0x1234567890n, 128).endCell()
            const msgTemplate = beginCell()
                .storeUint(0xf8a7ea5, 32)
                .storeUint(0, 64) // op, queryId
                .storeCoins(sentAmount)
                .storeAddress(notDeployer.address)
                .storeAddress(deployer.address)
                .storeMaybeRef(null)
                .storeCoins(toNano("0.05")) // No forward payload indication
            const errCodes = [9]
            let res = await sendTransferPayload(
                deployer.address,
                deployerJettonWallet.address,
                msgTemplate.endCell(),
            )

            assertFailTransfer(
                deployer.address,
                deployerJettonWallet.address,
                res.transactions,
                errCodes,
            )

            // Now test that we can't send message without payload if either flag is set
            let testPayload = beginCell().storeBuilder(msgTemplate).storeBit(true).endCell()
            res = await sendTransferPayload(
                deployer.address,
                deployerJettonWallet.address,
                testPayload,
            )

            assertFailTransfer(
                deployer.address,
                deployerJettonWallet.address,
                res.transactions,
                errCodes,
            )
            // Now valid payload
            testPayload = beginCell()
                .storeBuilder(msgTemplate)
                .storeBit(true)
                .storeRef(forwardPayload)
                .endCell()

            res = await sendTransferPayload(
                deployer.address,
                deployerJettonWallet.address,
                testPayload,
            )

            expect(res.transactions).toHaveTransaction({
                from: deployer.address,
                to: deployerJettonWallet.address,
                op: Op.transfer,
                success: true,
            })
        })
    })

    it("correctly sends forward_payload", async () => {
        const deployerJettonWallet = await userWallet(deployer.address)
        const initialJettonBalance = await deployerJettonWallet.getJettonBalance()
        const notDeployerJettonWallet = await userWallet(notDeployer.address)
        const initialJettonBalance2 = await notDeployerJettonWallet.getJettonBalance()
        const sentAmount = toNano("0.5")
        const forwardAmount = toNano("0.05")
        const forwardPayload = beginCell().storeUint(0x1234567890n, 128).endCell()
        // Make sure payload is different, so cell load is charged for each individual payload.
        const customPayload = beginCell().storeUint(0x0987654321n, 128).endCell()
        // Let's use this case for fees calculation
        // Put the forward payload into custom payload, to make sure maximum possible gas used during computation
        const sendResult = await deployerJettonWallet.sendTransfer(
            deployer.getSender(),
            toNano("0.17"), // tons
            sentAmount,
            notDeployer.address,
            deployer.address,
            customPayload,
            forwardAmount,
            forwardPayload,
        )
        expect(sendResult.transactions).toHaveTransaction({
            // excesses
            from: notDeployerJettonWallet.address,
            to: deployer.address,
        })
        /*
        transfer_notification#7362d09c query_id:uint64 amount:(VarUInteger 16)
                                      sender:MsgAddress forward_payload:(Either Cell ^Cell)
                                      = InternalMsgBody;
        */
        expect(sendResult.transactions).toHaveTransaction({
            // notification
            from: notDeployerJettonWallet.address,
            to: notDeployer.address,
            value: forwardAmount,
            body: beginCell()
                .storeUint(Op.transfer_notification, 32)
                .storeUint(0, 64) // default queryId
                .storeCoins(sentAmount)
                .storeAddress(deployer.address)
                .storeUint(1, 1)
                .storeRef(forwardPayload)
                .endCell(),
        })
        const transferTx = findTransactionRequired(sendResult.transactions, {
            on: deployerJettonWallet.address,
            from: deployer.address,
            op: Op.transfer,
            success: true,
        })
        send_gas_fee = printTxGasStats("Jetton transfer", transferTx)
        send_gas_fee = computeGasFee(gasPrices, gasForTransfer)

        const receiveTx = findTransactionRequired(sendResult.transactions, {
            on: notDeployerJettonWallet.address,
            from: deployerJettonWallet.address,
            op: Op.internal_transfer,
            success: true,
        })
        receive_gas_fee = printTxGasStats("Receive jetton", receiveTx)
        receive_gas_fee = computeGasFee(gasPrices, gasForTransfer)

        expect(await deployerJettonWallet.getJettonBalance()).toEqual(
            initialJettonBalance - sentAmount,
        )
        expect(await notDeployerJettonWallet.getJettonBalance()).toEqual(
            initialJettonBalance2 + sentAmount,
        )
    })

    it("no forward_ton_amount - no forward", async () => {
        const deployerJettonWallet = await userWallet(deployer.address)
        const initialJettonBalance = await deployerJettonWallet.getJettonBalance()
        const notDeployerJettonWallet = await userWallet(notDeployer.address)
        const initialJettonBalance2 = await notDeployerJettonWallet.getJettonBalance()
        const sentAmount = toNano("0.5")
        const forwardAmount = 0n
        const forwardPayload = beginCell().storeUint(0x1234567890n, 128).endCell()
        const sendResult = await deployerJettonWallet.sendTransfer(
            deployer.getSender(),
            toNano("0.1"), // tons
            sentAmount,
            notDeployer.address,
            deployer.address,
            null,
            forwardAmount,
            forwardPayload,
        )
        expect(sendResult.transactions).toHaveTransaction({
            // excesses
            from: notDeployerJettonWallet.address,
            to: deployer.address,
        })

        expect(sendResult.transactions).not.toHaveTransaction({
            // no notification
            from: notDeployerJettonWallet.address,
            to: notDeployer.address,
        })
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(
            initialJettonBalance - sentAmount,
        )
        expect(await notDeployerJettonWallet.getJettonBalance()).toEqual(
            initialJettonBalance2 + sentAmount,
        )
    })

    it("check revert on not enough tons for forward", async () => {
        const deployerJettonWallet = await userWallet(deployer.address)
        const initialJettonBalance = await deployerJettonWallet.getJettonBalance()
        await deployer.send({value: toNano("1"), bounce: false, to: deployerJettonWallet.address})
        const sentAmount = toNano("0.1")
        const forwardAmount = toNano("0.3")
        const forwardPayload = beginCell().storeUint(0x1234567890n, 128).endCell()
        const sendResult = await deployerJettonWallet.sendTransfer(
            deployer.getSender(),
            forwardAmount, // not enough tons, no tons for gas
            sentAmount,
            notDeployer.address,
            deployer.address,
            null,
            forwardAmount,
            forwardPayload,
        )
        expect(sendResult.transactions).toHaveTransaction({
            from: deployer.address,
            on: deployerJettonWallet.address,
            aborted: true,
            exitCode: ExtendedGovernanceJettonMinter.errors["Insufficient amount of TON attached"], // error::not_enough_tons
        })
        // Make sure value bounced
        expect(sendResult.transactions).toHaveTransaction({
            from: deployerJettonWallet.address,
            on: deployer.address,
            inMessageBounced: true,
            success: true,
        })

        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance)
    })
    /*
    This tests suit is skipped, as minimal fees are calculated in a different way.
    You can read more about this in dev-docs in this repository.

    As an alternative, other test suit below is provided.
     */
    describe.skip("Transfer dynamic fees", () => {
        // implementation detail
        it("works with minimal ton amount", async () => {
            // No forward_amount and forward_
            const jettonAmount = 1n
            const forwardAmount = 0n
            const minFwdFee = estimateTransferFwd(jettonAmount, forwardAmount, null, null)
            /*
                     forward_ton_amount +
                     fwd_count * fwd_fee +
                     (2 * gas_consumption + min_tons_for_storage));
        */
            const minimalFee = calcSendFees(
                send_gas_fee,
                receive_gas_fee,
                minFwdFee,
                forwardAmount,
                min_tons_for_storage,
            )
            // Off by one should fail
            await testSendFees(minimalFee - 1n, forwardAmount, null, null, false)
            // Now should succeed
            await testSendFees(minimalFee, forwardAmount, null, null, true)
            console.log("Minimal transfer fee:", fromNano(minimalFee))
        })
        it("forward_payload should impact transfer fees", async () => {
            const jettonAmount = 1n
            const forwardAmount = 0n
            let forwardPayload = beginCell().storeUint(0x123456789abcdef, 128).endCell()

            // We estimate without forward payload
            let minFwdFee = estimateTransferFwd(jettonAmount, forwardAmount, null, null)
            let minimalFee = calcSendFees(
                send_gas_fee,
                receive_gas_fee,
                minFwdFee,
                forwardAmount,
                min_tons_for_storage,
            )
            // Should fail
            await testSendFees(minimalFee, forwardAmount, forwardPayload, null, false)
            // We should re-estimate now
            minFwdFee = estimateTransferFwd(jettonAmount, forwardAmount, forwardPayload, null)
            minimalFee = calcSendFees(
                send_gas_fee,
                receive_gas_fee,
                minFwdFee,
                forwardAmount,
                min_tons_for_storage,
            )
            // Add succeed
            await testSendFees(minimalFee, forwardAmount, forwardPayload, null, true)
            // Now let's see if increase in size would impact fee.
            forwardPayload = beginCell()
                .storeUint(getRandomInt(100000, 200000), 128)
                .storeRef(forwardPayload)
                .endCell()
            // Should fail now
            await testSendFees(minimalFee, forwardAmount, forwardPayload, null, false)

            minFwdFee = estimateTransferFwd(jettonAmount, forwardAmount, forwardPayload, null)
            minimalFee = calcSendFees(
                send_gas_fee,
                receive_gas_fee,
                minFwdFee,
                forwardAmount,
                min_tons_for_storage,
            )
            // And succeed again, after updating calculations
            await testSendFees(minimalFee, forwardAmount, forwardPayload, null, true)
            // Custom payload impacts fee, because forwardAmount is calculated based on inMsg fwdFee field
            /*
        const customPayload = beginCell().storeUint(getRandomInt(100000, 200000), 128).endCell();
        await testSendFees(minimalFee, forwardAmount, forwardPayload, customPayload, true);
        */
        })
        it("forward amount > 0 should account for forward fee twice", async () => {
            const jettonAmount = 1n
            const forwardAmount = toNano("0.05")
            const forwardPayload = beginCell().storeUint(0x123456789abcdef, 128).endCell()

            const minFwdFee = estimateTransferFwd(jettonAmount, forwardAmount, forwardPayload, null)
            // We estimate without forward amount
            let minimalFee = calcSendFees(
                send_gas_fee,
                receive_gas_fee,
                minFwdFee,
                0n,
                min_tons_for_storage,
            )
            // Should fail
            await testSendFees(minimalFee, forwardAmount, forwardPayload, null, false)
            // Adding forward fee once more + forwardAmount should end up in successful transfer
            minimalFee += minFwdFee + forwardAmount
            await testSendFees(minimalFee, forwardAmount, forwardPayload, null, true)
            // Make sure this is actual edge value and not just excessive amount
            // Off by one should fail
            await testSendFees(minimalFee - 1n, forwardAmount, forwardPayload, null, false)
        })
        it("forward fees should be calculated using actual config values", async () => {
            const jettonAmount = 1n
            const forwardAmount = toNano("0.05")
            const forwardPayload = beginCell().storeUint(0x123456789abcdef, 128).endCell()

            const minFwdFee = estimateTransferFwd(jettonAmount, forwardAmount, forwardPayload, null)
            // We estimate everything correctly
            let minimalFee = calcSendFees(
                send_gas_fee,
                receive_gas_fee,
                minFwdFee,
                forwardAmount,
                min_tons_for_storage,
            )
            // Results in the successful transfer
            await testSendFees(minimalFee, forwardAmount, forwardPayload, null, true)

            const oldConfig = blockchain.config
            const newPrices: MsgPrices = {
                ...msgPrices,
                bitPrice: msgPrices.bitPrice * 10n,
                cellPrice: msgPrices.cellPrice * 10n,
            }
            blockchain.setConfig(setMsgPrices(blockchain.config, newPrices, 0))

            await testSendFees(minimalFee, forwardAmount, forwardPayload, null, false)

            const newFwdFee = estimateTransferFwd(
                jettonAmount,
                forwardAmount,
                forwardPayload,
                null,
                newPrices,
            )

            minimalFee += (newFwdFee - minFwdFee) * 2n + defaultOverhead * 9n

            /*
         * We can't do it like this anymore, because change in forward prices
         * also may change rounding in reverse fee calculation
        // Delta is 18 times old fee because oldFee x 2 is already accounted
        // for two forward
        const newOverhead = forwardOverhead(newPrices, stateInitStats);
        minimalFee += (minFwdFee - msgPrices.lumpPrice) * 18n + defaultOverhead * 9n;
        */
            // Should succeed now
            await testSendFees(minimalFee, forwardAmount, forwardPayload, null, true)
            // Testing edge
            await testSendFees(minimalFee - 1n, forwardAmount, forwardPayload, null, false)
            // Rolling config back
            blockchain.setConfig(oldConfig)
        })
        it("gas fees for transfer should be calculated from actual config", async () => {
            const jettonAmount = 1n
            const forwardAmount = toNano("0.05")
            const forwardPayload = beginCell().storeUint(0x123456789abcdef, 128).endCell()

            const minFwdFee = estimateTransferFwd(jettonAmount, forwardAmount, forwardPayload, null)
            // We estimate everything correctly
            let minimalFee = calcSendFees(
                send_gas_fee,
                receive_gas_fee,
                minFwdFee,
                forwardAmount,
                min_tons_for_storage,
            )
            // Results in the successful transfer
            await testSendFees(minimalFee, forwardAmount, forwardPayload, null, true)
            const oldConfig = blockchain.config
            blockchain.setConfig(
                setGasPrice(
                    oldConfig,
                    {
                        ...gasPrices,
                        gas_price: gasPrices.gas_price * 3n,
                    },
                    0,
                ),
            )
            await testSendFees(minimalFee, forwardAmount, forwardPayload, null, false)
            // add gas delta
            minimalFee +=
                (send_gas_fee - gasPrices.flat_gas_price) * 2n +
                (receive_gas_fee - gasPrices.flat_gas_price) * 2n
            await testSendFees(minimalFee, forwardAmount, forwardPayload, null, true)
            // Test edge
            await testSendFees(minimalFee - 1n, forwardAmount, forwardPayload, null, false)
            blockchain.setConfig(oldConfig)
        })
        it("storage fee for transfer should be calculated from actual config", async () => {
            const jettonAmount = 1n
            const forwardAmount = toNano("0.05")
            const forwardPayload = beginCell().storeUint(0x123456789abcdef, 128).endCell()

            const minFwdFee = estimateTransferFwd(jettonAmount, forwardAmount, forwardPayload, null)
            // We estimate everything correctly
            let minimalFee = calcSendFees(
                send_gas_fee,
                receive_gas_fee,
                minFwdFee,
                forwardAmount,
                min_tons_for_storage,
            )
            // Results in the successful transfer
            await testSendFees(minimalFee, forwardAmount, forwardPayload, null, true)

            const oldConfig = blockchain.config
            const newPrices = {
                ...storagePrices,
                bit_price_ps: storagePrices.bit_price_ps * 10n,
                cell_price_ps: storagePrices.cell_price_ps * 10n,
            }

            blockchain.setConfig(setStoragePrices(oldConfig, newPrices))

            await testSendFees(minimalFee, forwardAmount, forwardPayload, null, false)

            const newStorageFee = calcStorageFee(
                newPrices,
                walletStats,
                BigInt(5 * 365 * 24 * 3600),
            )
            minimalFee += newStorageFee - min_tons_for_storage

            await testSendFees(minimalFee, forwardAmount, forwardPayload, null, true)
            // Tet edge
            await testSendFees(minimalFee - 1n, forwardAmount, forwardPayload, null, false)
            blockchain.setConfig(oldConfig)
        })
    })

    describe("Tact-way fees", () => {
        function getComputeGasForTx(tx: BlockchainTransaction) {
            return (
                (tx.description as TransactionDescriptionGeneric)
                    .computePhase as TransactionComputeVm
            ).gasUsed
        }

        it("transfers with specified gas", async () => {
            const deployerJettonWallet = await userWallet(deployer.address)
            const randomNewReceiver = randomAddress(0)
            const sendResult = await deployerJettonWallet.sendTransfer(
                deployer.getSender(),
                toNano("0.1"), // tons
                0n, // Transfer 0 jettons, it doesn't affect the fee
                randomNewReceiver,
                deployer.address,
                null,
                toNano("0.05"),
                null,
            )
            // From sender to jw
            console.log("Gas for send transfer", getComputeGasForTx(sendResult.transactions[1]!))
            expect(getComputeGasForTx(sendResult.transactions[1]!)).toBeLessThanOrEqual(
                gasForTransfer,
            )
            // From jw to jw
            console.log("Gas for receive transfer", getComputeGasForTx(sendResult.transactions[2]))
            expect(getComputeGasForTx(sendResult.transactions[2])).toBeLessThanOrEqual(
                gasForTransfer,
            )
        })
        it("Burns with specified gas", async () => {
            const sendResult = await jettonMinter.sendForceBurn(
                deployer.getSender(),
                0n, // Burn 0 jettons, it doesn't affect the fee
                deployer.address,
                deployer.address,
                toNano(0.1),
            )

            // Remember, that it is governance Jettons
            // From jettonMaster to jw
            console.log("Gas for send burn", getComputeGasForTx(sendResult.transactions[2]!))
            expect(getComputeGasForTx(sendResult.transactions[2]!)).toBeLessThanOrEqual(gasForBurn)
            // From jw to jetton_master
            console.log("Gas for receive burn", getComputeGasForTx(sendResult.transactions[3]))
            expect(getComputeGasForTx(sendResult.transactions[3])).toBeLessThanOrEqual(gasForBurn)
        })
    })
    // implementation detail
    it("wallet does not accept internal_transfer not from wallet", async () => {
        const deployerJettonWallet = await userWallet(deployer.address)
        const initialJettonBalance = await deployerJettonWallet.getJettonBalance()
        /*
  internal_transfer  query_id:uint64 amount:(VarUInteger 16) from:MsgAddress
                     response_address:MsgAddress
                     forward_ton_amount:(VarUInteger 16)
                     forward_payload:(Either Cell ^Cell)
                     = InternalMsgBody;
*/
        const internalTransfer = beginCell()
            .storeUint(0x178d4519, 32)
            .storeUint(0, 64) // default queryId
            .storeCoins(toNano("0.01"))
            .storeAddress(deployer.address)
            .storeAddress(deployer.address)
            .storeCoins(toNano("0.05"))
            .storeUint(0, 1)
            .endCell()
        const sendResult = await blockchain.sendMessage(
            internal({
                from: notDeployer.address,
                to: deployerJettonWallet.address,
                body: internalTransfer,
                value: toNano("0.3"),
            }),
        )
        expect(sendResult.transactions).toHaveTransaction({
            from: notDeployer.address,
            to: deployerJettonWallet.address,
            aborted: true,
            exitCode: ExtendedGovernanceJettonMinter.errors["Incorrect sender"], // error::unauthorized_incoming_transfer
        })
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance)
    })

    // Yeah, you got that right
    // Wallet owner should not be able to burn it's jettons
    it("wallet owner should not be able to burn jettons", async () => {
        const deployerJettonWallet = await userWallet(deployer.address)
        const initialJettonBalance = await deployerJettonWallet.getJettonBalance()
        const initialTotalSupply = await jettonMinter.getTotalSupply()
        const burnAmount = toNano("0.01")
        const sendResult = await deployerJettonWallet.sendBurn(
            deployer.getSender(),
            toNano("0.1"), // ton amount
            burnAmount,
            deployer.address,
            null,
        ) // amount, response address, custom payload
        expect(sendResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: deployerJettonWallet.address,
            aborted: true,
            exitCode: ExtendedGovernanceJettonMinter.errors["Not owner"], // error::unauthorized_transfer
        })
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance)
        expect(await jettonMinter.getTotalSupply()).toEqual(initialTotalSupply)
    })

    it("not wallet owner should not be able to burn jettons", async () => {
        const deployerJettonWallet = await userWallet(deployer.address)
        const initialJettonBalance = await deployerJettonWallet.getJettonBalance()
        const initialTotalSupply = await jettonMinter.getTotalSupply()
        const burnAmount = toNano("0.01")
        const sendResult = await deployerJettonWallet.sendBurn(
            notDeployer.getSender(),
            toNano("0.1"), // ton amount
            burnAmount,
            deployer.address,
            null,
        ) // amount, response address, custom payload
        expect(sendResult.transactions).toHaveTransaction({
            from: notDeployer.address,
            to: deployerJettonWallet.address,
            aborted: true,
            exitCode: ExtendedGovernanceJettonMinter.errors["Not owner"], // error::unauthorized_transfer
        })
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance)
        expect(await jettonMinter.getTotalSupply()).toEqual(initialTotalSupply)
    })

    it("minter admin should be able to burn wallet jettons", async () => {
        const burnAmount = BigInt(getRandomInt(100000, 200000))
        const customPayload = beginCell().storeUint(getRandomInt(100000, 200000), 128).endCell()
        const burnTxs = await testBurnFees(
            toNano("1"),
            deployer.address,
            burnAmount,
            0,
            customPayload,
        )
        const actualSent = printTxGasStats("Burn transaction", burnTxs[0])
        const actualRecv = printTxGasStats("Burn notification transaction", burnTxs[1])
        burn_gas_fee = computeGasFee(gasPrices, gasForBurn)
        burn_notification_fee = computeGasFee(gasPrices, gasForBurn)
        expect(burn_gas_fee).toBeGreaterThanOrEqual(actualSent)
        expect(burn_notification_fee).toBeGreaterThanOrEqual(actualRecv)
    })
    it("wallet owner can not burn more jettons than it has", async () => {
        const deployerJettonWallet = await userWallet(deployer.address)
        const initialJettonBalance = await deployerJettonWallet.getJettonBalance()
        const _initialTotalSupply = await jettonMinter.getTotalSupply()
        const burnAmount = initialJettonBalance + 1n
        const msgValue = toNano("1")
        await testBurnFees(
            msgValue,
            deployer.address,
            burnAmount,
            ExtendedGovernanceJettonMinter.errors["Incorrect balance after send"],
            null,
        )
    })

    /*
    This tests suit is skipped, as minimal fees are calculated in a different way.
    You can read more about this in dev-docs in this repository.

    `Tact-way fees` test-suit is provided as an alternative.
     */
    describe.skip("Burn dynamic fees", () => {
        it("minimal burn message fee", async () => {
            const burnAmount = toNano("0.01")
            const burnFwd = estimateBurnFwd()
            const minimalFee = burnFwd + burn_gas_fee + burn_notification_fee + 1n

            // Off by one
            await testBurnFees(
                minimalFee - 1n,
                deployer.address,
                burnAmount,
                ExtendedGovernanceJettonMinter.errors["Insufficient amount of TON attached"],
                null,
            )
            // Now should succeed
            console.log("Minimal burn fee:", fromNano(minimalFee))
            const _res = await testBurnFees(minimalFee, deployer.address, burnAmount, 0, null)
        })
        // Now custom payload does impact forward fee, because it is calculated from input message fwdFee
        it("burn custom payload should not impact fees", async () => {
            const burnAmount = toNano("0.01")
            const customPayload = beginCell().storeUint(getRandomInt(1000, 2000), 256).endCell()
            const burnFwd = estimateBurnFwd()
            const minimalFee = burnFwd + burn_gas_fee + burn_notification_fee + 1n
            await testBurnFees(minimalFee, deployer.address, burnAmount, 0, customPayload)
        })
        it("burn forward fee should be calculated from actual config values", async () => {
            const burnAmount = toNano("0.01")
            const burnFwd = estimateBurnFwd()
            let minimalFee = burnFwd + burn_gas_fee + burn_notification_fee + 1n
            // Succeeds initially

            await testBurnFees(minimalFee, deployer.address, burnAmount, 0, null)

            const oldConfig = blockchain.config
            const newPrices: MsgPrices = {
                ...msgPrices,
                bitPrice: msgPrices.bitPrice * 10n,
                cellPrice: msgPrices.cellPrice * 10n,
            }
            blockchain.setConfig(setMsgPrices(blockchain.config, newPrices, 0))
            // Now fail
            await testBurnFees(
                minimalFee,
                deployer.address,
                burnAmount,
                ExtendedGovernanceJettonMinter.errors["Insufficient amount of TON attached"],
                null,
                newPrices,
            )
            const newFwd = estimateBurnFwd(newPrices)
            minimalFee += newFwd - burnFwd
            // Success again
            await testBurnFees(minimalFee, deployer.address, burnAmount, 0, null, newPrices)
            // Check edge
            await testBurnFees(
                minimalFee - 1n,
                deployer.address,
                burnAmount,
                ExtendedGovernanceJettonMinter.errors["Insufficient amount of TON attached"],
                null,
                newPrices,
            )
            blockchain.setConfig(oldConfig)
        })
        it("burn gas fees should be calculated from actual config values", async () => {
            const burnAmount = toNano("0.01")
            const burnFwd = estimateBurnFwd()
            let minimalFee = burnFwd + burn_gas_fee + burn_notification_fee + 1n
            // Succeeds initially
            await testBurnFees(minimalFee, deployer.address, burnAmount, 0, null)
            const oldConfig = blockchain.config
            blockchain.setConfig(
                setGasPrice(
                    oldConfig,
                    {
                        ...gasPrices,
                        gas_price: gasPrices.gas_price * 3n,
                    },
                    0,
                ),
            )
            await testBurnFees(
                minimalFee,
                deployer.address,
                burnAmount,
                ExtendedGovernanceJettonMinter.errors["Insufficient amount of TON attached"],
                null,
            )

            minimalFee +=
                (burn_gas_fee - gasPrices.flat_gas_price) * 2n +
                (burn_notification_fee - gasPrices.flat_gas_price) * 2n

            await testBurnFees(minimalFee, deployer.address, burnAmount, 0, null)
            // Verify edge
            await testBurnFees(
                minimalFee - 1n,
                deployer.address,
                burnAmount,
                ExtendedGovernanceJettonMinter.errors["Insufficient amount of TON attached"],
                null,
            )
            blockchain.setConfig(oldConfig)
        })
    })

    it("minter should only accept burn messages from jetton wallets", async () => {
        const deployerJettonWallet = await userWallet(deployer.address)
        const burnAmount = toNano("1")
        const burnNotification = (amount: bigint, addr: Address) => {
            return beginCell()
                .storeUint(Op.burn_notification, 32)
                .storeUint(0, 64)
                .storeCoins(amount)
                .storeAddress(addr)
                .storeAddress(deployer.address)
                .endCell()
        }

        let res = await blockchain.sendMessage(
            internal({
                from: deployerJettonWallet.address,
                to: jettonMinter.address,
                body: burnNotification(burnAmount, randomAddress(0)),
                value: toNano("0.1"),
            }),
        )

        expect(res.transactions).toHaveTransaction({
            from: deployerJettonWallet.address,
            to: jettonMinter.address,
            aborted: true,
            exitCode: ExtendedGovernanceJettonMinter.errors["Unauthorized burn"], // Unauthorized burn
        })

        res = await blockchain.sendMessage(
            internal({
                from: deployerJettonWallet.address,
                to: jettonMinter.address,
                body: burnNotification(burnAmount, deployer.address),
                value: toNano("0.1"),
            }),
        )

        expect(res.transactions).toHaveTransaction({
            from: deployerJettonWallet.address,
            to: jettonMinter.address,
            success: true,
        })
    })

    // TEP-89
    it("report correct discovery address", async () => {
        let discoveryResult = await jettonMinter.sendDiscovery(
            deployer.getSender(),
            deployer.address,
            true,
        )
        /*
          take_wallet_address#d1735400 query_id:uint64 wallet_address:MsgAddress owner_address:(Maybe ^MsgAddress) = InternalMsgBody;
        */
        const deployerJettonWallet = await userWallet(deployer.address)

        const discoveryTx = findTransactionRequired(discoveryResult.transactions, {
            from: jettonMinter.address,
            to: deployer.address,
            body: beginCell()
                .storeUint(Op.take_wallet_address, 32)
                .storeUint(0, 64)
                .storeAddress(deployerJettonWallet.address)
                .storeUint(1, 1)
                .storeRef(beginCell().storeAddress(deployer.address).endCell())
                .endCell(),
        })

        printTxGasStats("Discovery transaction", discoveryTx)

        discoveryResult = await jettonMinter.sendDiscovery(
            deployer.getSender(),
            notDeployer.address,
            true,
        )
        const notDeployerJettonWallet = await userWallet(notDeployer.address)
        expect(discoveryResult.transactions).toHaveTransaction({
            from: jettonMinter.address,
            to: deployer.address,
            body: beginCell()
                .storeUint(Op.take_wallet_address, 32)
                .storeUint(0, 64)
                .storeAddress(notDeployerJettonWallet.address)
                .storeUint(1, 1)
                .storeRef(beginCell().storeAddress(notDeployer.address).endCell())
                .endCell(),
        })

        // do not include owner address
        discoveryResult = await jettonMinter.sendDiscovery(
            deployer.getSender(),
            notDeployer.address,
            false,
        )
        expect(discoveryResult.transactions).toHaveTransaction({
            from: jettonMinter.address,
            to: deployer.address,
            body: beginCell()
                .storeUint(Op.take_wallet_address, 32)
                .storeUint(0, 64)
                .storeAddress(notDeployerJettonWallet.address)
                .storeUint(0, 1)
                .endCell(),
        })
    })

    it.skip("Minimal discovery fee", async () => {
        // 5000 gas-units + msg_forward_prices.lump_price + msg_forward_prices.cell_price = 0.0061
        const fwdFee = 1464012n
        const minimalFee = fwdFee + 10000000n // toNano('0.0061');

        let discoveryResult = await jettonMinter.sendDiscovery(
            deployer.getSender(),
            notDeployer.address,
            false,
            minimalFee,
        )
        // Actually I did not add a require() in discovery, so it is just -14 from TVM
        expect(discoveryResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: jettonMinter.address,
            aborted: true,
            exitCode: -14, // discovery_fee_not_matched
        })

        /*
         * Might be helpful to have logical OR in expect lookup
         * Because here is what is stated in standard:
         * and either throw an exception if amount of incoming value is not enough to calculate wallet address
         * or response with message (sent with mode 64)
         * https://github.com/ton-blockchain/TEPs/blob/master/text/0089-jetton-wallet-discovery.md
         * At least something like
         * expect(discoveryResult.hasTransaction({such and such}) ||
         * discoveryResult.hasTransaction({yada yada})).toBeTruthy()
         */
        discoveryResult = await jettonMinter.sendDiscovery(
            deployer.getSender(),
            notDeployer.address,
            false,
            minimalFee + 1n,
        )

        expect(discoveryResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: jettonMinter.address,
            success: true,
        })
    })

    it("Correctly handles not valid address in discovery", async () => {
        const badAddr = randomAddress(-1)
        let discoveryResult = await jettonMinter.sendDiscovery(deployer.getSender(), badAddr, false)

        expect(discoveryResult.transactions).toHaveTransaction({
            from: jettonMinter.address,
            to: deployer.address,
            body: beginCell()
                .storeUint(Op.take_wallet_address, 32)
                .storeUint(0, 64)
                .storeUint(0, 2) // addr_none
                .storeUint(0, 1)
                .endCell(),
        })

        // Include address should still be available

        discoveryResult = await jettonMinter.sendDiscovery(deployer.getSender(), badAddr, true) // Include addr

        expect(discoveryResult.transactions).toHaveTransaction({
            from: jettonMinter.address,
            to: deployer.address,
            body: beginCell()
                .storeUint(Op.take_wallet_address, 32)
                .storeUint(0, 64)
                .storeUint(0, 2) // addr_none
                .storeUint(1, 1)
                .storeRef(beginCell().storeAddress(badAddr).endCell())
                .endCell(),
        })
    })

    // This test consume a lot of time: 18 sec
    // and is needed only for measuring ton accruing
    /* it('jettonWallet can process 250 transfer', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
        const notDeployerJettonWallet = await userWallet(notDeployer.address);
        let initialJettonBalance2 = await notDeployerJettonWallet.getJettonBalance();
        let sentAmount = 1n, count = 250n;
        let forwardAmount = toNano('0.05');
        let sendResult: any;
        let payload = beginCell()
                          .storeUint(0x12345678, 32).storeUint(0x87654321, 32)
                          .storeRef(beginCell().storeUint(0x12345678, 32).storeUint(0x87654321, 108).endCell())
                          .storeRef(beginCell().storeUint(0x12345671, 32).storeUint(0x87654321, 240).endCell())
                          .storeRef(beginCell().storeUint(0x12345672, 32).storeUint(0x87654321, 77)
                                               .storeRef(beginCell().endCell())
                                               .storeRef(beginCell().storeUint(0x1245671, 91).storeUint(0x87654321, 32).endCell())
                                               .storeRef(beginCell().storeUint(0x2245671, 180).storeUint(0x87654321, 32).endCell())
                                               .storeRef(beginCell().storeUint(0x8245671, 255).storeUint(0x87654321, 32).endCell())
                                    .endCell())
                      .endCell();
        let initialBalance =(await blockchain.getContract(deployerJettonWallet.address)).balance;
        let initialBalance2 = (await blockchain.getContract(notDeployerJettonWallet.address)).balance;
        for(let i = 0; i < count; i++) {
            sendResult = await deployerJettonWallet.sendTransferMessage(deployer.getSender(), toNano('0.1'), //tons
                   sentAmount, notDeployer.address,
                   deployer.address, null, forwardAmount, payload);
        }
        // last chain was successful
        expect(sendResult.transactions).toHaveTransaction({ //excesses
            from: notDeployerJettonWallet.address,
            to: deployer.address,
        });
        expect(sendResult.transactions).toHaveTransaction({ //notification
            from: notDeployerJettonWallet.address,
            to: notDeployer.address,
            value: forwardAmount
        });

        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance - sentAmount*count);
        expect(await notDeployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance2 + sentAmount*count);

        let finalBalance =(await blockchain.getContract(deployerJettonWallet.address)).balance;
        let finalBalance2 = (await blockchain.getContract(notDeployerJettonWallet.address)).balance;

        // if it is not true, it's ok but gas_consumption constant is too high
        // and excesses of TONs will be accrued on wallet
        expect(finalBalance).toBeLessThan(initialBalance + toNano('0.001'));
        expect(finalBalance2).toBeLessThan(initialBalance2 + toNano('0.001'));
        expect(finalBalance).toBeGreaterThan(initialBalance - toNano('0.001'));
        expect(finalBalance2).toBeGreaterThan(initialBalance2 - toNano('0.001'));

    });
    */
    // implementation detail
    it("can not send to masterchain", async () => {
        const deployerJettonWallet = await userWallet(deployer.address)
        const sentAmount = toNano("0.5")
        const forwardAmount = toNano("0.05")
        const sendResult = await deployerJettonWallet.sendTransfer(
            deployer.getSender(),
            toNano("0.1"), // tons
            sentAmount,
            Address.parse("Ef8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAU"),
            deployer.address,
            null,
            forwardAmount,
            null,
        )
        expect(sendResult.transactions).toHaveTransaction({
            // excesses
            from: deployer.address,
            to: deployerJettonWallet.address,
            aborted: true,
            exitCode: ExtendedGovernanceJettonMinter.errors["Not a basechain address"], // error::wrong_workchain
        })
    })

    describe("Locking", () => {
        let prevState: BlockchainSnapshot
        let testLockable: (from: Sender, addr: Address, exp: boolean) => Promise<void>
        let testCanBeUnlocked: (from: Sender, addr: Address, exp: boolean) => Promise<void>
        let testCap: (
            lock: Array<LockType>,
            addr: Address,
            cb: () => Promise<void>,
        ) => Promise<void>

        beforeAll(() => {
            prevState = blockchain.snapshot()
            // blockchain.verbosity.vmLogs = "vm_logs_verbose"
            testLockable = async (from, addr, exp) => {
                const lockTypes: Array<LockType> = ["out", "in", "full"]
                const lockWallet = await userWallet(addr)
                let i = 0

                for (const type of lockTypes) {
                    // (await blockchain.getContract(jettonMinter.address)).verbosity.vmLogs = "vm_logs_verbose";
                    await jettonMinter.sendLockWallet(from, addr, type)

                    const status = await lockWallet.getWalletStatus()
                    expect(Boolean(status & ++i)).toBe(exp)
                }
            }
            testCap = async (locks, addr, cb) => {
                const lockTypes: Array<LockType> = ["unlock", "out", "in", "full"]
                const lockWallet = await userWallet(addr)

                for (const mode of locks) {
                    const _res = await jettonMinter.sendLockWallet(deployer.getSender(), addr, mode)
                    expect(await lockWallet.getWalletStatus()).toEqual(
                        lockTypes.findIndex(t => t == mode),
                    )
                    await cb()
                }
            }
            testCanBeUnlocked = async (from, addr, exp) => {
                // Meh
                const lockTypes: Array<LockType> = ["out", "in", "full"]
                const lockWallet = await userWallet(addr)
                const statusBefore = await lockWallet.getWalletStatus()
                if (statusBefore == 0) {
                    await jettonMinter.sendLockWallet(deployer.getSender(), addr, "unlock")
                    expect(await lockWallet.getWalletStatus()).toEqual(0)
                }

                let i = 0

                for (const type of lockTypes) {
                    let _res = await jettonMinter.sendLockWallet(deployer.getSender(), addr, type)
                    expect(await lockWallet.getWalletStatus()).toEqual(++i)
                    // Now try unlock from that state
                    _res = await jettonMinter.sendLockWallet(from, addr, "unlock")
                    if (exp) {
                        expect(await lockWallet.getWalletStatus()).toEqual(0)
                    } else {
                        expect(await lockWallet.getWalletStatus()).not.toEqual(0)
                    }
                }
            }
        })
        it("Test status change", async () => {
            const deployerJettonWallet = await userWallet(deployer.address)
            const statusBefore = await deployerJettonWallet.getWalletStatus()
            expect(statusBefore).toEqual(0)
            const _res = await jettonMinter.sendLockWallet(
                deployer.getSender(),
                deployer.address,
                "out",
            )
            expect(await deployerJettonWallet.getWalletStatus()).toEqual(1)
            await jettonMinter.sendLockWallet(deployer.getSender(), deployer.address, "unlock")
            expect(await deployerJettonWallet.getWalletStatus()).toEqual(0)
            await jettonMinter.sendLockWallet(deployer.getSender(), deployer.address, "in")
            expect(await deployerJettonWallet.getWalletStatus()).toEqual(2)
        })
        afterEach(async () => await blockchain.loadFrom(prevState))
        it("admin should be able to lock arbitrary jetton wallet", async () => {
            const deployerJettonWallet = await userWallet(deployer.address)
            const _notDeployerJettonWallet = await userWallet(notDeployer.address)
            const _msgValue = getRandomTon(1, 2)
            const statusBefore = await deployerJettonWallet.getWalletStatus()

            expect(statusBefore).toEqual(0)

            await testLockable(deployer.getSender(), deployer.address, true)
        })
        it("not admin should not be able to lock or unlock wallet", async () => {
            const deployerJettonWallet = await userWallet(deployer.address)
            const _notDeployerJettonWallet = await userWallet(notDeployer.address)
            const _msgValue = getRandomTon(1, 2)
            const statusBefore = await deployerJettonWallet.getWalletStatus()
            expect(statusBefore).toEqual(0)
            // Can't lock
            await testLockable(notDeployer.getSender(), notDeployer.address, false)

            // Can't unlock
            await testCanBeUnlocked(notDeployer.getSender(), deployer.address, false)
        })
        it("out and full locked wallet should not be able to send tokens", async () => {
            const deployerJettonWallet = await userWallet(deployer.address)
            await testCap(["out", "full"], deployer.address, async () => {
                const balanceBefore = await deployerJettonWallet.getJettonBalance()
                const res = await deployerJettonWallet.sendTransfer(
                    deployer.getSender(),
                    toNano("1"), // value
                    1n, // jetton_amount
                    notDeployer.address, // to
                    deployer.address, // response_address
                    null, // custom payload
                    0n, // forward_ton_amount
                    null,
                )
                expect(res.transactions).toHaveTransaction({
                    on: deployerJettonWallet.address,
                    from: deployer.address,
                    op: Op.transfer,
                    success: false,
                    aborted: true,
                    exitCode: ExtendedGovernanceJettonMinter.errors["Contract is locked"],
                })
                expect(res.transactions).not.toHaveTransaction({
                    from: deployerJettonWallet.address,
                    op: Op.transfer_notification,
                })
                expect(await deployerJettonWallet.getJettonBalance()).toEqual(balanceBefore)
            })
        })
        // With admin only mode doesn't make sense anymore
        it.skip("out and full locked wallet should not be able to burn tokens", async () => {
            const deployerJettonWallet = await userWallet(deployer.address)
            const _statusBefore = await deployerJettonWallet.getWalletStatus()

            await testCap(["out", "full"], deployer.address, async () => {
                const balanceBefore = await deployerJettonWallet.getJettonBalance()

                const res = await deployerJettonWallet.sendBurn(
                    deployer.getSender(),
                    toNano("1"),
                    1n,
                    deployer.address,
                    null,
                )

                expect(res.transactions).toHaveTransaction({
                    on: deployerJettonWallet.address,
                    from: deployer.address,
                    op: Op.burn,
                    success: false,
                    aborted: true,
                    exitCode: ExtendedGovernanceJettonMinter.errors["Contract is locked"],
                })
                expect(res.transactions).not.toHaveTransaction({
                    from: deployerJettonWallet.address,
                    op: Op.burn_notification,
                })

                expect(await deployerJettonWallet.getJettonBalance()).toEqual(balanceBefore)
            })
        })
        it("out locked wallet should be able to receive jettons", async () => {
            const deployerJettonWallet = await userWallet(deployer.address)
            const notDeployerJettonWallet = await userWallet(notDeployer.address)

            await jettonMinter.sendLockWallet(deployer.getSender(), notDeployer.address, "out")
            expect(await notDeployerJettonWallet.getWalletStatus()).toEqual(1)

            const balanceBefore = await notDeployerJettonWallet.getJettonBalance()

            await deployerJettonWallet.sendTransfer(
                deployer.getSender(),
                toNano("1"),
                1n,
                notDeployer.address,
                deployer.address,
                null,
                toNano("0.05"),
                null,
            )
            expect(await notDeployerJettonWallet.getJettonBalance()).toEqual(balanceBefore + 1n)
        })
        it("in and full locked wallet should not be able to receive jettons", async () => {
            const deployerJettonWallet = await userWallet(deployer.address)
            const notDeployerJettonWallet = await userWallet(notDeployer.address)
            await testCap(["in", "full"], notDeployer.address, async () => {
                const balanceBefore = await notDeployerJettonWallet.getJettonBalance()
                const deployerBefore = await deployerJettonWallet.getJettonBalance()

                const res = await deployerJettonWallet.sendTransfer(
                    deployer.getSender(),
                    toNano("1"),
                    1n,
                    notDeployer.address,
                    deployer.address,
                    null,
                    toNano("0.05"),
                    null,
                )
                expect(res.transactions).toHaveTransaction({
                    on: notDeployerJettonWallet.address,
                    op: Op.internal_transfer,
                    success: false,
                    exitCode:
                        ExtendedGovernanceJettonMinter.errors["Incoming transfers are locked"],
                })
                // Bonus check that deployer didn't loose any balance due to bounce
                expect(res.transactions).toHaveTransaction({
                    on: deployerJettonWallet.address,
                    from: notDeployerJettonWallet.address,
                    inMessageBounced: true,
                })
                expect(await deployerJettonWallet.getJettonBalance()).toEqual(deployerBefore)
                // Main check
                expect(await notDeployerJettonWallet.getJettonBalance()).toEqual(balanceBefore)
            })
        })
        it("admin should be able to unlock locked wallet", async () => {
            await testCanBeUnlocked(deployer.getSender(), deployer.address, true)
            await testCanBeUnlocked(deployer.getSender(), notDeployer.address, true)
        })
        describe("Force transfer", () => {
            let prevState: BlockchainSnapshot
            beforeAll(() => (prevState = blockchain.snapshot()))
            afterAll(async () => await blockchain.loadFrom(prevState))

            it("admin should be able to force jetton transfer", async () => {
                const deployerJettonWallet = await userWallet(deployer.address)
                const notDeployerJettonWallet = await userWallet(notDeployer.address)
                const msgValue = getRandomTon(10, 20)
                const fwdAmount = msgValue / 2n
                const txAmount = BigInt(getRandomInt(1, 100))
                const customPayload = beginCell().storeUint(getRandomInt(1000, 2000), 32).endCell()
                const fwdPayload = beginCell().storeUint(getRandomInt(1000, 2000), 32).endCell()
                const balanceBefore = await deployerJettonWallet.getJettonBalance()

                const res = await jettonMinter.sendForceTransfer(
                    deployer.getSender(),
                    txAmount,
                    deployer.address,
                    notDeployer.address,
                    customPayload,
                    fwdAmount,
                    fwdPayload,
                    msgValue,
                )
                // Transfer request was sent to notDeployer wallet and was processed
                expect(res.transactions).toHaveTransaction({
                    from: jettonMinter.address,
                    on: notDeployerJettonWallet.address,
                    op: Op.transfer,
                    body: x =>
                        testJettonTransfer(x!, {
                            to: deployer.address,
                            response_address: deployer.address,
                            amount: txAmount,
                            forward_amount: fwdAmount,
                            custom_payload: customPayload,
                            forward_payload: fwdPayload,
                        }),
                    success: true,
                    value: msgValue,
                })
                expect(res.transactions).toHaveTransaction({
                    from: notDeployerJettonWallet.address,
                    on: deployerJettonWallet.address,
                    op: Op.internal_transfer,
                    body: x =>
                        testJettonInternalTransfer(x!, {
                            from: notDeployer.address,
                            response: deployer.address,
                            amount: txAmount,
                            forwardAmount: fwdAmount,
                            payload: fwdPayload,
                        }),
                    success: true,
                })
                expect(res.transactions).toHaveTransaction({
                    on: deployer.address,
                    from: deployerJettonWallet.address,
                    op: Op.transfer_notification,
                    body: x =>
                        testJettonNotification(x!, {
                            amount: txAmount,
                            from: notDeployer.address,
                            payload: fwdPayload,
                        }),
                    value: fwdAmount,
                    success: true,
                })
                expect(await deployerJettonWallet.getJettonBalance()).toEqual(
                    balanceBefore + txAmount,
                )
            })
            it("not admin should not be able to force transfer", async () => {
                const txAmount = BigInt(getRandomInt(1, 100))

                const res = await jettonMinter.sendForceTransfer(
                    notDeployer.getSender(),
                    txAmount,
                    notDeployer.address, // To
                    deployer.address, // From
                    null,
                    toNano("0.25"),
                    null,
                    toNano("1"),
                )
                expect(res.transactions).toHaveTransaction({
                    on: jettonMinter.address,
                    from: notDeployer.address,
                    op: Op.call_to,
                    success: false,
                    aborted: true,
                    exitCode: ExtendedGovernanceJettonMinter.errors["Incorrect sender"],
                })
                expect(res.transactions).not.toHaveTransaction({
                    from: jettonMinter.address,
                    op: Op.transfer,
                })
            })
            it("admin should be able to force transfer even locked jettons", async () => {
                const deployerJettonWallet = await userWallet(deployer.address)
                const notDeployerJettonWallet = await userWallet(notDeployer.address)
                const txAmount = BigInt(getRandomInt(1, 100))

                await testCap(["in", "out", "full"], notDeployer.address, async () => {
                    const balanceBefore = await deployerJettonWallet.getJettonBalance()
                    const res = await jettonMinter.sendForceTransfer(
                        deployer.getSender(),
                        txAmount,
                        deployer.address, // To
                        notDeployer.address, // From
                        null,
                        toNano("0.15"),
                        null,
                        toNano("1"),
                    )
                    expect(res.transactions).not.toHaveTransaction({
                        on: notDeployerJettonWallet.address,
                        from: jettonMinter.address,
                        op: Op.transfer,
                        exitCode: ExtendedGovernanceJettonMinter.errors["Contract is locked"],
                    })
                    expect(res.transactions).toHaveTransaction({
                        on: deployer.address,
                        from: deployerJettonWallet.address,
                        op: Op.transfer_notification,
                        body: x =>
                            testJettonNotification(x!, {
                                amount: txAmount,
                                from: notDeployer.address,
                            }),
                    })
                    expect(await deployerJettonWallet.getJettonBalance()).toEqual(
                        balanceBefore + txAmount,
                    )
                })
            })
            describe.skip("Force transfer fees", () => {
                it("force transfer works with minimal ton amount", async () => {
                    // No forward_amount and forward_
                    const jettonAmount = 1n
                    const forwardAmount = 0n
                    const minFwdFee = estimateAdminTransferFwd(
                        jettonAmount,
                        null,
                        forwardAmount,
                        null,
                    )
                    console.log("Estimate fwd:", minFwdFee)
                    /*
                         forward_ton_amount +
                         fwd_count * fwd_fee +
                         (2 * gas_consumption + min_tons_for_storage));
            */
                    const minimalFee = calcSendFees(
                        send_gas_fee,
                        receive_gas_fee,
                        minFwdFee,
                        forwardAmount,
                        min_tons_for_storage,
                    )
                    console.log("Minimal fee:", minimalFee)
                    // Off by one should fail
                    // Commented out as fees are calculated differently in Tact-governance
                    // await testAdminTransfer(
                    //     minimalFee - 1n,
                    //     jettonAmount,
                    //     deployer.address,
                    //     forwardAmount,
                    //     null,
                    //     null,
                    //     ExtendedGovernanceJettonMinter.errors["Insufficient amount of TON attached"],
                    // )
                    // Now should succeed
                    await testAdminTransfer(
                        minimalFee,
                        jettonAmount,
                        deployer.address,
                        forwardAmount,
                        null,
                        null,
                        0,
                    )
                    console.log("Minimal admin transfer fee:", fromNano(minimalFee))
                })
                it("forward_payload should impact transfer fees", async () => {
                    const jettonAmount = 1n
                    const forwardAmount = 0n
                    let forwardPayload = beginCell().storeUint(0x123456789abcdef, 128).endCell()

                    // We estimate without forward payload
                    let minFwdFee = estimateAdminTransferFwd(
                        jettonAmount,
                        null,
                        forwardAmount,
                        null,
                    )
                    let minimalFee = calcSendFees(
                        send_gas_fee,
                        receive_gas_fee,
                        minFwdFee,
                        forwardAmount,
                        min_tons_for_storage,
                    )
                    // Should fail
                    // Commented out as fees are calculated differently in Tact-governance
                    // await testAdminTransfer(
                    //     minimalFee,
                    //     jettonAmount,
                    //     deployer.address,
                    //     forwardAmount,
                    //     null,
                    //     forwardPayload,
                    //     ExtendedGovernanceJettonMinter.errors["Insufficient amount of TON attached"],
                    // )
                    // We should re-estimate now
                    let newFwdFee = estimateAdminTransferFwd(
                        jettonAmount,
                        null,
                        forwardAmount,
                        forwardPayload,
                    )
                    minimalFee += newFwdFee - minFwdFee
                    minFwdFee = newFwdFee
                    // Add succeed
                    await testAdminTransfer(
                        minimalFee,
                        jettonAmount,
                        deployer.address,
                        forwardAmount,
                        null,
                        forwardPayload,
                        0,
                    )
                    // Now let's see if increase in size would impact fee.
                    // We add 4^6 Cells
                    forwardPayload = storeBigPayload(beginCell(), 6).endCell()
                    // Should fail now
                    await testAdminTransfer(
                        minimalFee,
                        jettonAmount,
                        deployer.address,
                        forwardAmount,
                        null,
                        forwardPayload,
                        ExtendedGovernanceJettonMinter.errors[
                            "Insufficient amount of TON attached"
                        ],
                    )

                    newFwdFee = estimateAdminTransferFwd(
                        jettonAmount,
                        null,
                        forwardAmount,
                        forwardPayload,
                    )

                    minimalFee += newFwdFee - minFwdFee
                    // And succeed again, after updating calculations
                    await testAdminTransfer(
                        minimalFee,
                        jettonAmount,
                        deployer.address,
                        forwardAmount,
                        null,
                        forwardPayload,
                        0,
                    )
                    // Test edge
                    await testAdminTransfer(
                        minimalFee - 1n,
                        jettonAmount,
                        deployer.address,
                        forwardAmount,
                        null,
                        forwardPayload,
                        ExtendedGovernanceJettonMinter.errors[
                            "Insufficient amount of TON attached"
                        ],
                    )
                    // Custom payload impacts fee, because forwardAmount is calculated based on inMsg fwdFee field
                    /*
            const customPayload = beginCell().storeUint(getRandomInt(100000, 200000), 128).endCell();
            await testSendFees(minimalFee, forwardAmount, forwardPayload, customPayload, true);
            */
                })
                it("forward amount > 0 should account for forward fee twice", async () => {
                    const jettonAmount = 1n
                    const forwardAmount = toNano("0.05")
                    const forwardPayload = beginCell().storeUint(0x123456789abcdef, 128).endCell()

                    const minFwdFee = estimateAdminTransferFwd(
                        jettonAmount,
                        null,
                        forwardAmount,
                        forwardPayload,
                    )
                    // We estimate without forward amount
                    let minimalFee = calcSendFees(
                        send_gas_fee,
                        receive_gas_fee,
                        minFwdFee,
                        0n,
                        min_tons_for_storage,
                    )
                    // Should fail
                    await testAdminTransfer(
                        minimalFee,
                        jettonAmount,
                        deployer.address,
                        forwardAmount,
                        null,
                        forwardPayload,
                        ExtendedGovernanceJettonMinter.errors[
                            "Insufficient amount of TON attached"
                        ],
                    )
                    // Adding forward fee once more + forwardAmount should end up in successful transfer
                    minimalFee += minFwdFee + forwardAmount
                    await testAdminTransfer(
                        minimalFee,
                        jettonAmount,
                        deployer.address,
                        forwardAmount,
                        null,
                        forwardPayload,
                        0,
                    )
                    // Make sure this is actual edge value and not just excessive amount
                    // Off by one should fail
                    await testAdminTransfer(
                        minimalFee - 1n,
                        jettonAmount,
                        deployer.address,
                        forwardAmount,
                        null,
                        forwardPayload,
                        ExtendedGovernanceJettonMinter.errors[
                            "Insufficient amount of TON attached"
                        ],
                    )
                })
                it("forward fees should be calculated using actual config values", async () => {
                    const jettonAmount = 1n
                    const forwardAmount = toNano("0.05")
                    const forwardPayload = beginCell().storeUint(0x123456789abcdef, 128).endCell()

                    const minFwdFee = estimateAdminTransferFwd(
                        jettonAmount,
                        null,
                        forwardAmount,
                        forwardPayload,
                    )
                    // We estimate everything correctly
                    let minimalFee = calcSendFees(
                        send_gas_fee,
                        receive_gas_fee,
                        minFwdFee,
                        forwardAmount,
                        min_tons_for_storage,
                    )
                    // Results in the successful transfer
                    await testAdminTransfer(
                        minimalFee,
                        jettonAmount,
                        deployer.address,
                        forwardAmount,
                        null,
                        forwardPayload,
                        0,
                    )

                    const oldConfig = blockchain.config
                    const newPrices: MsgPrices = {
                        ...msgPrices,
                        bitPrice: msgPrices.bitPrice * 10n,
                        cellPrice: msgPrices.cellPrice * 10n,
                    }
                    blockchain.setConfig(setMsgPrices(blockchain.config, newPrices, 0))

                    await testAdminTransfer(
                        minimalFee,
                        jettonAmount,
                        deployer.address,
                        forwardAmount,
                        null,
                        forwardPayload,
                        ExtendedGovernanceJettonMinter.errors[
                            "Insufficient amount of TON attached"
                        ],
                    )
                    const newFwdFee = estimateAdminTransferFwd(
                        jettonAmount,
                        null,
                        forwardAmount,
                        forwardPayload,
                        newPrices,
                    )

                    minimalFee += (newFwdFee - minFwdFee) * 2n + defaultOverhead * 9n

                    /*
             * We can't do it like this anymore, because change in forward prices
             * also may change rounding in reverse fee calculation
            // Delta is 18 times old fee because oldFee x 2 is already accounted
            // for two forward
            const newOverhead = forwardOverhead(newPrices, stateInitStats);
            minimalFee += (minFwdFee - msgPrices.lumpPrice) * 18n + defaultOverhead * 9n;
            */
                    // Should succeed now
                    await testAdminTransfer(
                        minimalFee,
                        jettonAmount,
                        deployer.address,
                        forwardAmount,
                        null,
                        forwardPayload,
                        0,
                    )
                    // Testing edge
                    await testAdminTransfer(
                        minimalFee - 1n,
                        jettonAmount,
                        deployer.address,
                        forwardAmount,
                        null,
                        forwardPayload,
                        ExtendedGovernanceJettonMinter.errors[
                            "Insufficient amount of TON attached"
                        ],
                    )
                    // Rolling config back
                    blockchain.setConfig(oldConfig)
                })
                it("gas fees for transfer should be calculated from actual config", async () => {
                    const jettonAmount = 1n
                    const forwardAmount = toNano("0.05")
                    const forwardPayload = beginCell().storeUint(0x123456789abcdef, 128).endCell()

                    const minFwdFee = estimateAdminTransferFwd(
                        jettonAmount,
                        null,
                        forwardAmount,
                        forwardPayload,
                    )
                    // We estimate everything correctly
                    let minimalFee = calcSendFees(
                        send_gas_fee,
                        receive_gas_fee,
                        minFwdFee,
                        forwardAmount,
                        min_tons_for_storage,
                    )
                    // Results in the successful transfer
                    await testAdminTransfer(
                        minimalFee,
                        jettonAmount,
                        deployer.address,
                        forwardAmount,
                        null,
                        forwardPayload,
                        0,
                    )
                    const oldConfig = blockchain.config
                    blockchain.setConfig(
                        setGasPrice(
                            oldConfig,
                            {
                                ...gasPrices,
                                gas_price: gasPrices.gas_price * 3n,
                            },
                            0,
                        ),
                    )
                    await testAdminTransfer(
                        minimalFee,
                        jettonAmount,
                        deployer.address,
                        forwardAmount,
                        null,
                        forwardPayload,
                        ExtendedGovernanceJettonMinter.errors[
                            "Insufficient amount of TON attached"
                        ],
                    )
                    // add gas delta
                    minimalFee +=
                        (send_gas_fee - gasPrices.flat_gas_price) * 2n +
                        (receive_gas_fee - gasPrices.flat_gas_price) * 2n
                    await testAdminTransfer(
                        minimalFee,
                        jettonAmount,
                        deployer.address,
                        forwardAmount,
                        null,
                        forwardPayload,
                        0,
                    )
                    // Test edge
                    await testAdminTransfer(
                        minimalFee - 1n,
                        jettonAmount,
                        deployer.address,
                        forwardAmount,
                        null,
                        forwardPayload,
                        ExtendedGovernanceJettonMinter.errors[
                            "Insufficient amount of TON attached"
                        ],
                    )
                    blockchain.setConfig(oldConfig)
                })
                it("storage fee for transfer should be calculated from actual config", async () => {
                    const jettonAmount = 1n
                    const forwardAmount = toNano("0.05")
                    const forwardPayload = beginCell().storeUint(0x123456789abcdef, 128).endCell()

                    const minFwdFee = estimateAdminTransferFwd(
                        jettonAmount,
                        null,
                        forwardAmount,
                        forwardPayload,
                    )
                    // We estimate everything correctly
                    let minimalFee = calcSendFees(
                        send_gas_fee,
                        receive_gas_fee,
                        minFwdFee,
                        forwardAmount,
                        min_tons_for_storage,
                    )
                    await testAdminTransfer(
                        minimalFee,
                        jettonAmount,
                        deployer.address,
                        forwardAmount,
                        null,
                        forwardPayload,
                        0,
                    )
                    // Results in the successful transfer

                    const oldConfig = blockchain.config
                    const newPrices = {
                        ...storagePrices,
                        bit_price_ps: storagePrices.bit_price_ps * 10n,
                        cell_price_ps: storagePrices.cell_price_ps * 10n,
                    }

                    blockchain.setConfig(setStoragePrices(oldConfig, newPrices))

                    await testAdminTransfer(
                        minimalFee,
                        jettonAmount,
                        deployer.address,
                        forwardAmount,
                        null,
                        forwardPayload,
                        ExtendedGovernanceJettonMinter.errors[
                            "Insufficient amount of TON attached"
                        ],
                    )

                    const newStorageFee = calcStorageFee(
                        newPrices,
                        walletStats,
                        BigInt(5 * 365 * 24 * 3600),
                    )
                    minimalFee += newStorageFee - min_tons_for_storage

                    await testAdminTransfer(
                        minimalFee,
                        jettonAmount,
                        deployer.address,
                        forwardAmount,
                        null,
                        forwardPayload,
                        0,
                    )
                    // Tet edge
                    await testAdminTransfer(
                        minimalFee - 1n,
                        jettonAmount,
                        deployer.address,
                        forwardAmount,
                        null,
                        forwardPayload,
                        ExtendedGovernanceJettonMinter.errors[
                            "Insufficient amount of TON attached"
                        ],
                    )
                    blockchain.setConfig(oldConfig)
                })
            })
        })
        describe("Force burn", () => {
            let prevState: BlockchainSnapshot
            beforeAll(() => (prevState = blockchain.snapshot()))
            afterAll(async () => await blockchain.loadFrom(prevState))

            it("admin should be able to force burn jettons in arbitrary wallet", async () => {
                const _notDeployerJettonWallet = await userWallet(notDeployer.address)
                const msgValue = getRandomTon(10, 20)
                const burnAmount = BigInt(getRandomInt(1, 100))
                await testAdminBurn(
                    msgValue,
                    burnAmount,
                    notDeployer.address,
                    deployer.address,
                    null,
                    0,
                )
            })
            it("not admin should not be able to force burn", async () => {
                const _deployerJettonWallet = await userWallet(deployer.address)
                const notDeployerJettonWallet = await userWallet(notDeployer.address)

                const msgValue = getRandomTon(10, 20)
                const burnAmount = BigInt(getRandomInt(1, 100))

                const balanceBefore = await notDeployerJettonWallet.getJettonBalance()
                const supplyBefore = await jettonMinter.getTotalSupply()

                const res = await jettonMinter.sendForceBurn(
                    notDeployer.getSender(),
                    burnAmount,
                    notDeployer.address,
                    deployer.address,
                    msgValue,
                )

                expect(res.transactions).toHaveTransaction({
                    on: jettonMinter.address,
                    from: notDeployer.address,
                    op: Op.call_to,
                    success: false,
                    aborted: true,
                })
                expect(res.transactions).not.toHaveTransaction({
                    from: jettonMinter.address,
                    op: Op.burn,
                })

                expect(await notDeployerJettonWallet.getJettonBalance()).toEqual(balanceBefore)
                expect(await jettonMinter.getTotalSupply()).toEqual(supplyBefore)
            })

            it("admin should be able to force burn even on locked wallet", async () => {
                const notDeployerJettonWallet = await userWallet(notDeployer.address)
                const burnAmount = BigInt(getRandomInt(1, 100))
                await testCap(["in", "out", "full"], notDeployer.address, async () => {
                    const _balanceBefore = await notDeployerJettonWallet.getJettonBalance()
                    const _supplyBefore = await jettonMinter.getTotalSupply()
                    const msgValue = getRandomTon(10, 20)

                    await testAdminBurn(
                        msgValue,
                        burnAmount,
                        notDeployer.address,
                        deployer.address,
                        null,
                        0,
                    )
                })
            })
            describe.skip("Burn fees", () => {
                it("minimal burn message fee", async () => {
                    const burnAmount = toNano("0.01")
                    const burnFwd = estimateBurnFwd()
                    const minimalFee = burnFwd + burn_gas_fee + burn_notification_fee + 1n

                    // Off by one
                    await testAdminBurn(
                        minimalFee - 1n,
                        burnAmount,
                        deployer.address,
                        deployer.address,
                        null,
                        ExtendedGovernanceJettonMinter.errors[
                            "Insufficient amount of TON attached"
                        ],
                    )
                    // Now should succeed
                    await testAdminBurn(
                        minimalFee,
                        burnAmount,
                        deployer.address,
                        deployer.address,
                        null,
                        0,
                    )
                    console.log("Minimal admin burn fee:", fromNano(minimalFee))
                })
                // Now custom payload does impact forward fee, because it is calculated from input message fwdFee
                it("burn custom payload should not impact fees", async () => {
                    const burnAmount = toNano("0.01")
                    const customPayload = beginCell()
                        .storeUint(getRandomInt(1000, 2000), 256)
                        .endCell()
                    const burnFwd = estimateBurnFwd()
                    const minimalFee = burnFwd + burn_gas_fee + burn_notification_fee + 1n
                    // Would fail if it impacts fees
                    await testAdminBurn(
                        minimalFee,
                        burnAmount,
                        deployer.address,
                        deployer.address,
                        customPayload,
                        0,
                    )
                })
                it("burn forward fee should be calculated from actual config values", async () => {
                    const burnAmount = toNano("0.01")
                    const burnFwd = estimateBurnFwd()
                    let minimalFee = burnFwd + burn_gas_fee + burn_notification_fee + 1n
                    // Succeeds initially

                    await testAdminBurn(
                        minimalFee,
                        burnAmount,
                        notDeployer.address,
                        deployer.address,
                        null,
                        0,
                    )

                    const oldConfig = blockchain.config
                    const newPrices: MsgPrices = {
                        ...msgPrices,
                        bitPrice: msgPrices.bitPrice * 10n,
                        cellPrice: msgPrices.cellPrice * 10n,
                    }
                    blockchain.setConfig(setMsgPrices(blockchain.config, newPrices, 0))
                    await testAdminBurn(
                        minimalFee,
                        burnAmount,
                        notDeployer.address,
                        deployer.address,
                        null,
                        ExtendedGovernanceJettonMinter.errors[
                            "Insufficient amount of TON attached"
                        ],
                    )
                    const newFwd = estimateBurnFwd(newPrices)
                    minimalFee += newFwd - burnFwd
                    // Can't do that due to reverse fee calculation rounding errors
                    // minimalFee += (burnFwd - msgPrices.lumpPrice) * 9n;

                    // Success again
                    await testAdminBurn(
                        minimalFee,
                        burnAmount,
                        notDeployer.address,
                        deployer.address,
                        null,
                        0,
                    )
                    // Check edge

                    await testAdminBurn(
                        minimalFee - 1n,
                        burnAmount,
                        notDeployer.address,
                        deployer.address,
                        null,
                        ExtendedGovernanceJettonMinter.errors[
                            "Insufficient amount of TON attached"
                        ],
                    )
                    blockchain.setConfig(oldConfig)
                })
                it("burn gas fees should be calculated from actual config values", async () => {
                    const burnAmount = toNano("0.01")
                    const burnFwd = estimateBurnFwd()
                    let minimalFee = burnFwd + burn_gas_fee + burn_notification_fee + 1n
                    // Succeeds initially
                    await testAdminBurn(
                        minimalFee,
                        burnAmount,
                        notDeployer.address,
                        deployer.address,
                        null,
                        0,
                    )
                    const oldConfig = blockchain.config
                    blockchain.setConfig(
                        setGasPrice(
                            oldConfig,
                            {
                                ...gasPrices,
                                gas_price: gasPrices.gas_price * 2n,
                            },
                            0,
                        ),
                    )
                    await testAdminBurn(
                        minimalFee,
                        burnAmount,
                        notDeployer.address,
                        deployer.address,
                        null,
                        ExtendedGovernanceJettonMinter.errors[
                            "Insufficient amount of TON attached"
                        ],
                    )

                    minimalFee +=
                        burn_gas_fee -
                        gasPrices.flat_gas_price /* 2n*/ +
                        (burn_notification_fee - gasPrices.flat_gas_price) // * 2n;

                    await testAdminBurn(
                        minimalFee,
                        burnAmount,
                        notDeployer.address,
                        deployer.address,
                        null,
                        0,
                    )
                    // Verify edge
                    await testAdminBurn(
                        minimalFee - 1n,
                        burnAmount,
                        notDeployer.address,
                        deployer.address,
                        null,
                        ExtendedGovernanceJettonMinter.errors[
                            "Insufficient amount of TON attached"
                        ],
                    )
                    blockchain.setConfig(oldConfig)
                })
            })
        })
    })
    describe("Bounces", () => {
        it("minter should restore supply on internal_transfer bounce", async () => {
            const deployerJettonWallet = await userWallet(deployer.address)
            const mintAmount = BigInt(getRandomInt(1000, 2000))
            const mintMsg = ExtendedGovernanceJettonMinter.mintMessage(
                deployer.address,
                mintAmount,
                null,
                null,
                null,
                toNano("0.1"),
                toNano("0.3"),
            )

            const supplyBefore = await jettonMinter.getTotalSupply()
            const minterSmc = await blockchain.getContract(jettonMinter.address)

            // Sending message but only processing first step of tx chain
            const res = await minterSmc.receiveMessage(
                internal({
                    from: deployer.address,
                    to: jettonMinter.address,
                    body: mintMsg,
                    value: toNano("1"),
                }),
            )

            expect(res.outMessagesCount).toEqual(1)
            const outMsgSc = res.outMessages.get(0)!.body.beginParse()
            expect(outMsgSc.preloadUint(32)).toEqual(Op.internal_transfer)
            expect(await jettonMinter.getTotalSupply()).toEqual(supplyBefore + mintAmount)

            await minterSmc.receiveMessage(
                internal({
                    from: deployerJettonWallet.address,
                    to: jettonMinter.address,
                    bounced: true,
                    body: beginCell().storeUint(0xffffffff, 32).storeSlice(outMsgSc).endCell(),
                    value: toNano("0.95"),
                }),
            )

            // Supply should change back
            expect(await jettonMinter.getTotalSupply()).toEqual(supplyBefore)
        })
        it("wallet should restore balance on internal_transfer bounce", async () => {
            const deployerJettonWallet = await userWallet(deployer.address)
            const notDeployerJettonWallet = await userWallet(notDeployer.address)
            const balanceBefore = await deployerJettonWallet.getJettonBalance()
            const txAmount = BigInt(getRandomInt(100, 200))
            const transferMsg = ExtendedGovernanceJettonWallet.transferMessage(
                txAmount,
                notDeployer.address,
                deployer.address,
                null,
                0n,
                null,
            )

            const walletSmc = await blockchain.getContract(deployerJettonWallet.address)

            const res = await walletSmc.receiveMessage(
                internal({
                    from: deployer.address,
                    to: deployerJettonWallet.address,
                    body: transferMsg,
                    value: toNano("1"),
                }),
            )

            expect(res.outMessagesCount).toEqual(1)

            const outMsgSc = res.outMessages.get(0)!.body.beginParse()
            expect(outMsgSc.preloadUint(32)).toEqual(Op.internal_transfer)

            expect(await deployerJettonWallet.getJettonBalance()).toEqual(balanceBefore - txAmount)

            await walletSmc.receiveMessage(
                internal({
                    from: notDeployerJettonWallet.address,
                    to: walletSmc.address,
                    bounced: true,
                    body: beginCell().storeUint(0xffffffff, 32).storeSlice(outMsgSc).endCell(),
                    value: toNano("0.95"),
                }),
            )

            // Balance should roll back
            expect(await deployerJettonWallet.getJettonBalance()).toEqual(balanceBefore)
        })
        it("wallet should restore balance on burn_notification bounce", async () => {
            const deployerJettonWallet = await userWallet(deployer.address)
            const balanceBefore = await deployerJettonWallet.getJettonBalance()
            const burnAmount = BigInt(getRandomInt(100, 200))

            const burnMsg = ExtendedGovernanceJettonWallet.burnMessage(
                burnAmount,
                deployer.address,
                null,
            )

            const walletSmc = await blockchain.getContract(deployerJettonWallet.address)

            const res = await walletSmc.receiveMessage(
                internal({
                    from: jettonMinter.address,
                    to: deployerJettonWallet.address,
                    body: burnMsg,
                    value: toNano("1"),
                }),
            )

            expect(res.outMessagesCount).toEqual(1)

            const outMsgSc = res.outMessages.get(0)!.body.beginParse()
            expect(outMsgSc.preloadUint(32)).toEqual(Op.burn_notification)

            expect(await deployerJettonWallet.getJettonBalance()).toEqual(
                balanceBefore - burnAmount,
            )

            await walletSmc.receiveMessage(
                internal({
                    from: jettonMinter.address,
                    to: walletSmc.address,
                    bounced: true,
                    body: beginCell().storeUint(0xffffffff, 32).storeSlice(outMsgSc).endCell(),
                    value: toNano("0.95"),
                }),
            )

            // Balance should roll back
            expect(await deployerJettonWallet.getJettonBalance()).toEqual(balanceBefore)
        })
    })

    describe("Upgrade", () => {
        let prevState: BlockchainSnapshot

        let getContractData: (address: Address) => Promise<Cell>
        let getContractCode: (smc: Address) => Promise<Cell>
        beforeAll(() => {
            prevState = blockchain.snapshot()
            getContractData = async (address: Address) => {
                const smc = await blockchain.getContract(address)
                if (!smc.account.account) throw "Account not found"
                if (smc.account.account.storage.state.type != "active")
                    throw "Attempting to get data on inactive account"
                if (!smc.account.account.storage.state.state.data) throw "Data is not present"
                return smc.account.account.storage.state.state.data
            }
            getContractCode = async (address: Address) => {
                const smc = await blockchain.getContract(address)
                if (!smc.account.account) throw "Account not found"
                if (smc.account.account.storage.state.type != "active")
                    throw "Attempting to get code on inactive account"
                if (!smc.account.account.storage.state.state.code) throw "Code is not present"
                return smc.account.account.storage.state.state.code
            }
        })

        afterAll(async () => await blockchain.loadFrom(prevState))

        it("not admin should not be able to upgrade minter", async () => {
            const codeCell = beginCell()
                .storeUint(getRandomInt(1000, (1 << 32) - 1), 32)
                .endCell()
            const dataCell = beginCell()
                .storeUint(getRandomInt(1000, (1 << 32) - 1), 32)
                .endCell()

            const codeBefore = await getContractCode(jettonMinter.address)
            const dataBefore = await getContractData(jettonMinter.address)

            const notAdmin = differentAddress(deployer.address)

            const res = await jettonMinter.sendUpgrade(
                blockchain.sender(notAdmin),
                codeCell,
                dataCell,
            )

            expect(res.transactions).toHaveTransaction({
                on: jettonMinter.address,
                from: notAdmin,
                success: false,
                aborted: true,
            })

            // Excessive due to transaction is aborted, but still
            expect(await getContractCode(jettonMinter.address)).toEqualCell(codeBefore)
            expect(await getContractData(jettonMinter.address)).toEqualCell(dataBefore)
        })
        it("admin should be able to upgrade minter code and data", async () => {
            const codeCell = beginCell()
                .storeUint(getRandomInt(1000, (1 << 32) - 1), 32)
                .endCell()
            const dataCell = beginCell()
                .storeUint(getRandomInt(1000, (1 << 32) - 1), 32)
                .endCell()

            const res = await jettonMinter.sendUpgrade(deployer.getSender(), codeCell, dataCell)
            expect(res.transactions).toHaveTransaction({
                on: jettonMinter.address,
                from: deployer.address,
                op: Op.upgrade,
                success: true,
            })

            expect(await getContractCode(jettonMinter.address)).toEqualCell(codeCell)
            expect(await getContractData(jettonMinter.address)).toEqualCell(dataCell)
        })
    })

    // Current wallet version doesn't support those operations
    // implementation detail
    it.skip("owner can withdraw excesses", async () => {
        const deployerJettonWallet = await userWallet(deployer.address)
        await deployer.send({value: toNano("1"), bounce: false, to: deployerJettonWallet.address})
        const initialBalance = (await blockchain.getContract(deployer.address)).balance
        const withdrawResult = await deployerJettonWallet.sendWithdrawTons(deployer.getSender())
        expect(withdrawResult.transactions).toHaveTransaction({
            // excesses
            from: deployerJettonWallet.address,
            to: deployer.address,
        })
        const finalBalance = (await blockchain.getContract(deployer.address)).balance
        const finalWalletBalance = (await blockchain.getContract(deployerJettonWallet.address))
            .balance
        expect(finalWalletBalance).toEqual(min_tons_for_storage)
        expect(finalBalance - initialBalance).toBeGreaterThan(toNano("0.99"))
    })
    // implementation detail
    it.skip("not owner can not withdraw excesses", async () => {
        const deployerJettonWallet = await userWallet(deployer.address)
        await deployer.send({value: toNano("1"), bounce: false, to: deployerJettonWallet.address})
        const initialBalance = (await blockchain.getContract(deployer.address)).balance
        const withdrawResult = await deployerJettonWallet.sendWithdrawTons(notDeployer.getSender())
        expect(withdrawResult.transactions).not.toHaveTransaction({
            // excesses
            from: deployerJettonWallet.address,
            to: deployer.address,
        })
        const finalBalance = (await blockchain.getContract(deployer.address)).balance
        const finalWalletBalance = (await blockchain.getContract(deployerJettonWallet.address))
            .balance
        expect(finalWalletBalance).toBeGreaterThan(toNano("1"))
        expect(finalBalance - initialBalance).toBeLessThan(toNano("0.1"))
    })
    // implementation detail
    it.skip("owner can withdraw jettons owned by JettonWallet", async () => {
        const deployerJettonWallet = await userWallet(deployer.address)
        const sentAmount = toNano("0.5")
        const forwardAmount = toNano("0.05")
        await deployerJettonWallet.sendTransfer(
            deployer.getSender(),
            toNano("0.1"), // tons
            sentAmount,
            deployerJettonWallet.address,
            deployer.address,
            null,
            forwardAmount,
            null,
        )
        const childJettonWallet = await userWallet(deployerJettonWallet.address)
        const initialJettonBalance = await deployerJettonWallet.getJettonBalance()
        const initialChildJettonBalance = await childJettonWallet.getJettonBalance()
        expect(initialChildJettonBalance).toEqual(toNano("0.5"))
        const _withdrawResult = await deployerJettonWallet.sendWithdrawJettons(
            deployer.getSender(),
            childJettonWallet.address,
            toNano("0.4"),
        )
        expect((await deployerJettonWallet.getJettonBalance()) - initialJettonBalance).toEqual(
            toNano("0.4"),
        )
        expect(await childJettonWallet.getJettonBalance()).toEqual(toNano("0.1"))
        // withdraw the rest
        await deployerJettonWallet.sendWithdrawJettons(
            deployer.getSender(),
            childJettonWallet.address,
            toNano("0.1"),
        )
    })
    // implementation detail
    it.skip("not owner can not withdraw jettons owned by JettonWallet", async () => {
        const deployerJettonWallet = await userWallet(deployer.address)
        const sentAmount = toNano("0.5")
        const forwardAmount = toNano("0.05")
        await deployerJettonWallet.sendTransfer(
            deployer.getSender(),
            toNano("0.1"), // tons
            sentAmount,
            deployerJettonWallet.address,
            deployer.address,
            null,
            forwardAmount,
            null,
        )
        const childJettonWallet = await userWallet(deployerJettonWallet.address)
        const initialJettonBalance = await deployerJettonWallet.getJettonBalance()
        const initialChildJettonBalance = await childJettonWallet.getJettonBalance()
        expect(initialChildJettonBalance).toEqual(toNano("0.5"))
        const _withdrawResult = await deployerJettonWallet.sendWithdrawJettons(
            notDeployer.getSender(),
            childJettonWallet.address,
            toNano("0.4"),
        )
        expect((await deployerJettonWallet.getJettonBalance()) - initialJettonBalance).toEqual(
            toNano("0.0"),
        )
        expect(await childJettonWallet.getJettonBalance()).toEqual(toNano("0.5"))
    })
})
