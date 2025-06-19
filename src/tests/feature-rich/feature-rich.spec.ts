//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Studio

import {Address, beginCell, Cell, fromNano, toNano} from "@ton/core"
import {Blockchain, BlockchainSnapshot, SandboxContract, TreasuryContract} from "@ton/sandbox"
import {findTransactionRequired, randomAddress} from "@ton/test-utils"

import {JettonUpdateContent} from "../../output/Jetton_JettonMinter"
import {ExtendedFeatureRichJettonMinter} from "../../wrappers/ExtendedFeatureRichJettonMinter"
import {ExtendedFeatureRichJettonWallet} from "../../wrappers/ExtendedFeatureRichJettonWallet"
import {
    JettonMinterFeatureRich,
    SendAllJettonsMode,
    SendNotDeployReceiversJettonWallet,
    SendStateInitWithJettonNotification,
} from "../../output/FeatureRich_JettonMinterFeatureRich"
import {storeJettonNotification} from "../../output/FeatureRich_JettonWalletFeatureRich"

// this is test suite for feature rich jetton minter
// it makes heavy use of the custom payload and enables new functionality
describe("Feature Rich Jetton Minter", () => {
    let blockchain: Blockchain
    let jettonMinter: SandboxContract<ExtendedFeatureRichJettonMinter>
    let deployer: SandboxContract<TreasuryContract>

    let notDeployer: SandboxContract<TreasuryContract>

    let userWallet: (address: Address) => Promise<SandboxContract<ExtendedFeatureRichJettonWallet>>
    let defaultContent: Cell
    let snapshot: BlockchainSnapshot
    beforeAll(async () => {
        blockchain = await Blockchain.create()
        deployer = await blockchain.treasury("deployer")
        notDeployer = await blockchain.treasury("notDeployer")

        defaultContent = beginCell().endCell()
        const msg: JettonUpdateContent = {
            $$type: "JettonUpdateContent",
            queryId: 0n,
            content: defaultContent,
        }

        jettonMinter = blockchain.openContract(
            await ExtendedFeatureRichJettonMinter.fromInit(0n, deployer.address, defaultContent),
        )

        const deployResult = await jettonMinter.send(
            deployer.getSender(),
            {value: toNano("0.1")},
            msg,
        )

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: jettonMinter.address,
            deploy: true,
            success: true,
        })

        userWallet = async (address: Address) => {
            return blockchain.openContract(
                new ExtendedFeatureRichJettonWallet(
                    await jettonMinter.getGetWalletAddress(address),
                ),
            )
        }

        snapshot = blockchain.snapshot()
    })

    beforeEach(async () => {
        await blockchain.loadFrom(snapshot)
    })

    it("should send all jettons on send-all custom payload", async () => {
        const jettonMintAmount = toNano(10)
        await jettonMinter.sendMint(
            deployer.getSender(),
            deployer.address,
            jettonMintAmount,
            0n,
            toNano(1),
        )
        const deployerJettonWallet = await userWallet(deployer.address)
        const jettonBalance = await deployerJettonWallet.getJettonBalance()

        expect(jettonBalance).toEqual(jettonMintAmount)

        const randomNewReceiver = randomAddress(0)

        const sendAllJettonsResult = await deployerJettonWallet.sendTransferWithJettonMode(
            deployer.getSender(),
            toNano("0.1"), // tons
            0n,
            randomNewReceiver,
            deployer.address,
            0n,
            null,
            {
                $$type: "CustomPayloadWithSendModes",
                mode: SendAllJettonsMode,
                forwardStateInit: null,
            },
        )
        const receiverJettonWallet = await userWallet(randomNewReceiver)

        expect(sendAllJettonsResult.transactions).toHaveTransaction({
            from: deployerJettonWallet.address,
            to: receiverJettonWallet.address,
            op: ExtendedFeatureRichJettonWallet.opcodes.JettonTransferInternal,
            success: true,
        })

        const receiverJettonBalance = await receiverJettonWallet.getJettonBalance()
        expect(receiverJettonBalance).toEqual(jettonMintAmount)

        const deployerJettonBalanceAfter = await deployerJettonWallet.getJettonBalance()
        expect(deployerJettonBalanceAfter).toEqual(0n)
    })

    it("should not deploy receivers jetton wallet on not-deploy custom payload", async () => {
        const jettonMintAmount = toNano(10)
        await jettonMinter.sendMint(
            deployer.getSender(),
            deployer.address,
            jettonMintAmount,
            0n,
            toNano(1),
        )
        const deployerJettonWallet = await userWallet(deployer.address)
        const jettonBalance = await deployerJettonWallet.getJettonBalance()

        expect(jettonBalance).toEqual(jettonMintAmount)

        const randomNewReceiver = randomAddress(0)

        // deploy receiver jetton wallet, so it won't bounce later
        await deployerJettonWallet.sendTransfer(
            deployer.getSender(),
            toNano("0.1"), // tons
            0n, // no jettons
            randomNewReceiver,
            deployer.address,
            null,
            0n,
            null,
        )

        const sendResult = await deployerJettonWallet.sendTransferWithJettonMode(
            deployer.getSender(),
            toNano("0.1"), // tons
            0n,
            randomNewReceiver,
            deployer.address,
            0n,
            null,
            {
                $$type: "CustomPayloadWithSendModes",
                mode: SendNotDeployReceiversJettonWallet,
                forwardStateInit: null,
            },
        )

        const receiverJettonWallet = await userWallet(randomNewReceiver)

        expect(sendResult.transactions).toHaveTransaction({
            from: deployerJettonWallet.address,
            to: receiverJettonWallet.address,
            op: ExtendedFeatureRichJettonWallet.opcodes.JettonTransferInternal,
            initCode: (init?: Cell) => {
                return typeof init === "undefined" || init === null
            },
            initData: (init?: Cell) => {
                return typeof init === "undefined" || init === null
            },
            success: true,
        })
    })

    it("should be lower fwd fee with not-deploy on custom payload", async () => {
        const jettonMintAmount = toNano(10)
        await jettonMinter.sendMint(
            deployer.getSender(),
            deployer.address,
            jettonMintAmount,
            0n,
            toNano(1),
        )
        const deployerJettonWallet = await userWallet(deployer.address)
        const jettonBalance = await deployerJettonWallet.getJettonBalance()

        expect(jettonBalance).toEqual(jettonMintAmount)

        const randomNewReceiver = randomAddress(0)

        // deploy receiver jetton wallet, so it won't bounce later
        await deployerJettonWallet.sendTransfer(
            deployer.getSender(),
            toNano("0.1"), // tons
            0n, // no jettons
            randomNewReceiver,
            deployer.address,
            null,
            0n,
            null,
        )

        // ensure the messages expect the custom payload are the same
        const sendTonValue = toNano("0.1")
        const sendJettonValue = 0n
        const responseAddress = deployer.address
        const forwardTonAmount = 0n
        const forwardPayload = null

        const sendNotDeployResult = await deployerJettonWallet.sendTransferWithJettonMode(
            deployer.getSender(),
            sendTonValue, // tons
            sendJettonValue,
            randomNewReceiver,
            responseAddress,
            forwardTonAmount,
            forwardPayload,
            {
                $$type: "CustomPayloadWithSendModes",
                mode: SendNotDeployReceiversJettonWallet,
                forwardStateInit: null,
            },
        )

        const regularSendResult = await deployerJettonWallet.sendTransfer(
            deployer.getSender(),
            sendTonValue, // tons
            sendJettonValue,
            randomNewReceiver,
            responseAddress,
            null,
            forwardTonAmount,
            forwardPayload,
        )

        const receiverJettonWallet = await userWallet(randomNewReceiver)

        const internalTransferWithoutDeploy = findTransactionRequired(
            sendNotDeployResult.transactions,
            {
                from: deployerJettonWallet.address,
                to: receiverJettonWallet.address,
                op: ExtendedFeatureRichJettonWallet.opcodes.JettonTransferInternal,
                success: true,
            },
        )

        const regularInternalTransfer = findTransactionRequired(regularSendResult.transactions, {
            from: deployerJettonWallet.address,
            to: receiverJettonWallet.address,
            op: ExtendedFeatureRichJettonWallet.opcodes.JettonTransferInternal,
            success: true,
        })

        const internalTransferWithoutDeployFee =
            internalTransferWithoutDeploy.inMessage?.info.type === "internal"
                ? internalTransferWithoutDeploy.inMessage.info.forwardFee
                : 0n
        const regularInternalTransferFee =
            regularInternalTransfer.inMessage?.info.type === "internal"
                ? regularInternalTransfer.inMessage.info.forwardFee
                : 0n

        // 0.004030698 ton diff with current config
        console.log(
            "transfer without deploy diff",
            fromNano(regularInternalTransferFee - internalTransferWithoutDeployFee),
        )

        expect(internalTransferWithoutDeployFee).toBeLessThan(regularInternalTransferFee)
    })

    it("should handle bounce on not deploy receivers jetton wallet in custom payload", async () => {
        const jettonMintAmount = toNano(10)
        await jettonMinter.sendMint(
            deployer.getSender(),
            deployer.address,
            jettonMintAmount,
            0n,
            toNano(1),
        )
        const deployerJettonWallet = await userWallet(deployer.address)
        const jettonBalance = await deployerJettonWallet.getJettonBalance()

        expect(jettonBalance).toEqual(jettonMintAmount)

        const randomNewReceiver = randomAddress(0)

        // we send transfer without deployed receiver jetton wallet
        // so it will bounce
        const sendAllJettonsResult = await deployerJettonWallet.sendTransferWithJettonMode(
            deployer.getSender(),
            toNano("0.1"), // tons
            0n,
            randomNewReceiver,
            deployer.address,
            0n,
            null,
            {
                $$type: "CustomPayloadWithSendModes",
                mode: SendNotDeployReceiversJettonWallet,
                forwardStateInit: null,
            },
        )

        const receiverJettonWallet = await userWallet(randomNewReceiver)

        expect(sendAllJettonsResult.transactions).toHaveTransaction({
            from: receiverJettonWallet.address,
            to: deployerJettonWallet.address,
            inMessageBounced: true,
        })

        // bounce handled, balance restored
        const jettonBalanceAfterBounce = await deployerJettonWallet.getJettonBalance()
        expect(jettonBalanceAfterBounce).toEqual(jettonBalance)
    })

    it("should perform transfer as usual without custom payload", async () => {
        const jettonMintAmount = toNano(10)
        await jettonMinter.sendMint(
            deployer.getSender(),
            deployer.address,
            jettonMintAmount,
            0n,
            toNano(1),
        )

        await jettonMinter.sendMint(
            deployer.getSender(),
            notDeployer.address,
            0n, // just deploy
            0n,
            toNano(1),
        )

        const deployerJettonWallet = await userWallet(deployer.address)
        const initialJettonBalance = await deployerJettonWallet.getJettonBalance()

        const initialTotalSupply = await jettonMinter.getTotalSupply()
        const notDeployerJettonWallet = await userWallet(notDeployer.address)

        const initialJettonBalanceNotDeployer = await notDeployerJettonWallet.getJettonBalance()
        const sentAmount = toNano("0.5")
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
            // excesses
            from: notDeployerJettonWallet.address,
            to: deployer.address,
        })
        expect(sendResult.transactions).toHaveTransaction({
            // notification
            from: notDeployerJettonWallet.address,
            to: notDeployer.address,
            value: forwardAmount,
        })
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(
            initialJettonBalance - sentAmount,
        )
        expect(await notDeployerJettonWallet.getJettonBalance()).toEqual(
            initialJettonBalanceNotDeployer + sentAmount,
        )
        expect(await jettonMinter.getTotalSupply()).toEqual(initialTotalSupply)
    })

    it("should deploy jetton notification receiver with send mode send-deploy-notification-receiver", async () => {
        const jettonMintAmount = toNano(10)
        await jettonMinter.sendMint(
            deployer.getSender(),
            deployer.address,
            jettonMintAmount,
            0n,
            toNano(1),
        )
        const deployerJettonWallet = await userWallet(deployer.address)
        const jettonBalance = await deployerJettonWallet.getJettonBalance()

        expect(jettonBalance).toEqual(jettonMintAmount)

        const snapBeforeTreasury = blockchain.snapshot()
        const receiver = await blockchain.treasury("receiver")
        // we want to deploy receiver jetton wallet ourself, so revert this
        await blockchain.loadFrom(snapBeforeTreasury)

        const receiversStateInit = receiver.init

        const sendADeployNotificationReceiverResult =
            await deployerJettonWallet.sendTransferWithJettonMode(
                deployer.getSender(),
                toNano("1.5"), // tons
                0n,
                receiver.address,
                deployer.address,
                toNano(1), // forward amount
                null,
                {
                    $$type: "CustomPayloadWithSendModes",
                    mode: SendStateInitWithJettonNotification,
                    forwardStateInit: {
                        $$type: "StateInit",
                        code: receiversStateInit.code!,
                        data: receiversStateInit.data!,
                    },
                },
            )

        const expectedNotificationBody = beginCell()
            .store(
                storeJettonNotification({
                    $$type: "JettonNotification",
                    queryId: 0n,
                    amount: 0n,
                    sender: deployer.address,
                    forwardPayload: beginCell().storeUint(0, 1).endCell().beginParse(),
                }),
            )
            .endCell()

        const receiverJettonWallet = await userWallet(receiver.address)

        expect(sendADeployNotificationReceiverResult.transactions).toHaveTransaction({
            from: receiverJettonWallet.address,
            op: JettonMinterFeatureRich.opcodes.JettonNotification,
            body: expectedNotificationBody, // we didn't break basic notify functionality
            initCode: receiversStateInit.code!,
            initData: receiversStateInit.data!,
            success: true,
            deploy: true, // we deployed it ourself
        })
    })

    it("should revert if state init doesn't belong to the notification receiver", async () => {
        const jettonMintAmount = toNano(10)
        await jettonMinter.sendMint(
            deployer.getSender(),
            deployer.address,
            jettonMintAmount,
            0n,
            toNano(1),
        )
        const deployerJettonWallet = await userWallet(deployer.address)
        const jettonBalance = await deployerJettonWallet.getJettonBalance()

        expect(jettonBalance).toEqual(jettonMintAmount)

        const snapBeforeTreasury = blockchain.snapshot()
        const receiver = await blockchain.treasury("receiver")
        const receiverBad = await blockchain.treasury("receiver-2")
        // we want to deploy receiver jetton wallet ourself, so revert this
        await blockchain.loadFrom(snapBeforeTreasury)

        const receiversStateInit = receiverBad.init

        const sendADeployNotificationReceiverResult =
            await deployerJettonWallet.sendTransferWithJettonMode(
                deployer.getSender(),
                toNano("1.5"), // tons
                0n,
                receiver.address,
                deployer.address,
                toNano(1), // forward amount
                null,
                {
                    $$type: "CustomPayloadWithSendModes",
                    mode: SendStateInitWithJettonNotification,
                    forwardStateInit: {
                        $$type: "StateInit",
                        code: receiversStateInit.code!,
                        data: receiversStateInit.data!,
                    },
                },
            )

        const receiverJettonWallet = await userWallet(receiver.address)

        expect(sendADeployNotificationReceiverResult.transactions).toHaveTransaction({
            from: deployerJettonWallet.address,
            to: receiverJettonWallet.address,
            op: JettonMinterFeatureRich.opcodes.JettonTransferInternalWithStateInit,
            success: false,
            exitCode: JettonMinterFeatureRich.errors["Deploy address doesn't match owner address"],
        })
    })
})
