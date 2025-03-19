import {Address, Builder, beginCell, Cell, toNano} from "@ton/core"
import {Blockchain, internal, SandboxContract, TreasuryContract} from "@ton/sandbox"
import {ExtendedJettonWallet} from "../wrappers/ExtendedJettonWallet"
import {ExtendedJettonMinter} from "../wrappers/ExtendedJettonMinter"

import {
    JettonUpdateContent,
    storeJettonBurn,
    storeJettonTransfer,
    storeMint,
    JettonMinter,
    minTonsForStorage,
} from "../output/Jetton_JettonMinter"

import "@ton/test-utils"
import {getRandomInt, randomAddress} from "../utils/utils"
import {JettonWallet} from "../output/Jetton_JettonWallet"
import {randomBytes} from "crypto"

function jettonContentToCell(content: {type: 0 | 1; uri: string}) {
    return beginCell()
        .storeUint(content.type, 8)
        .storeStringTail(content.uri) //Snake logic under the hood
        .endCell()
}

// this test suite includes tests from original reference TEP-74 implementation
// https://github.com/ton-blockchain/token-contract/blob/main/sandbox_tests/JettonWallet.spec.ts
describe("Jetton Minter", () => {
    let blockchain: Blockchain
    let jettonMinter: SandboxContract<ExtendedJettonMinter>
    let jettonWallet: SandboxContract<ExtendedJettonWallet>
    let deployer: SandboxContract<TreasuryContract>

    let _jwallet_code = new Cell()
    let _minter_code = new Cell()
    let notDeployer: SandboxContract<TreasuryContract>

    let userWallet: (address: Address) => Promise<SandboxContract<ExtendedJettonWallet>>
    let defaultContent: Cell
    beforeAll(async () => {
        // Create content Cell

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
            await ExtendedJettonMinter.fromInit(0n, deployer.address, defaultContent),
        )

        //We send Update content to deploy the contract, because it is not automatically deployed after blockchain.openContract
        //And to deploy it we should send any message. But update content message with same content does not affect anything. That is why I chose it.
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
        const minterCode = jettonMinter.init?.code
        if (minterCode === undefined) {
            throw new Error("JettonMinter init is not defined")
        } else {
            _minter_code = minterCode
        }

        jettonWallet = blockchain.openContract(
            await ExtendedJettonWallet.fromInit(0n, deployer.address, jettonMinter.address),
        )
        const walletCode = jettonWallet.init?.code
        if (walletCode === undefined) {
            throw new Error("JettonWallet init is not defined")
        } else {
            _jwallet_code = walletCode
        }

        userWallet = async (address: Address) => {
            return blockchain.openContract(
                new ExtendedJettonWallet(await jettonMinter.getGetWalletAddress(address)),
            )
        }
    })

    // implementation detail
    it("should deploy", async () => {
        expect(jettonMinter).toBeDefined()
        expect(jettonWallet).toBeDefined()
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
            toNano("0.05"),
            toNano("1"),
        )

        expect(mintResult.transactions).toHaveTransaction({
            from: jettonMinter.address,
            to: deployerJettonWallet.address,
            deploy: true,
        })
        //Here was the check, that excesses are send to JettonMinter.
        //This is an implementation-defined behavior
        //In my implementation, excesses are sent to the deployer
        expect(mintResult.transactions).toHaveTransaction({
            // excesses
            from: deployerJettonWallet.address,
            to: deployer.address,
        })

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
            toNano("0.05"),
            toNano("1"),
        )

        expect(unAuthMintResult.transactions).toHaveTransaction({
            from: notDeployer.address,
            to: jettonMinter.address,
            aborted: true,
            exitCode: JettonMinter.errors["Incorrect sender"],
        })
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance)
        expect(await jettonMinter.getTotalSupply()).toEqual(initialTotalSupply)
    })

    // Implementation detail
    it("minter admin can change admin", async () => {
        const adminBefore = await jettonMinter.getAdminAddress()
        expect(adminBefore).toEqualAddress(deployer.address)
        const res = await jettonMinter.sendChangeAdmin(deployer.getSender(), notDeployer.address)
        expect(res.transactions).toHaveTransaction({
            from: deployer.address,
            on: jettonMinter.address,
            success: true,
        })

        const adminAfter = await jettonMinter.getAdminAddress()
        expect(adminAfter).toEqualAddress(notDeployer.address)
        await jettonMinter.sendChangeAdmin(notDeployer.getSender(), deployer.address)
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
            exitCode: JettonMinter.errors["Incorrect sender"],
        })
    })

    it("minter admin can change content", async () => {
        const newContent = jettonContentToCell({
            type: 1,
            uri: "https://totally_new_jetton.org/content.json",
        })
        expect((await jettonMinter.getContent()).equals(defaultContent)).toBe(true)
        await jettonMinter.sendChangeContent(deployer.getSender(), newContent)
        expect((await jettonMinter.getContent()).equals(newContent)).toBe(true)
        await jettonMinter.sendChangeContent(deployer.getSender(), defaultContent)
        expect((await jettonMinter.getContent()).equals(defaultContent)).toBe(true)
    })
    it("not a minter admin can not change content", async () => {
        const newContent = beginCell().storeUint(1, 1).endCell()
        const changeContent = await jettonMinter.sendChangeContent(
            notDeployer.getSender(),
            newContent,
        )
        expect((await jettonMinter.getContent()).equals(defaultContent)).toBe(true)
        expect(changeContent.transactions).toHaveTransaction({
            from: notDeployer.address,
            to: jettonMinter.address,
            aborted: true,
            exitCode: JettonMinter.errors["Incorrect sender"],
        })
    })
    it("wallet owner should be able to send jettons", async () => {
        const deployerJettonWallet = await userWallet(deployer.address)
        const initialJettonBalance = await deployerJettonWallet.getJettonBalance()
        const initialTotalSupply = await jettonMinter.getTotalSupply()
        const notDeployerJettonWallet = await userWallet(notDeployer.address)
        const initialJettonBalance2 = await notDeployerJettonWallet.getJettonBalance()
        const sentAmount = toNano("0.5")
        const forwardAmount = toNano("0.05")
        const sendResult = await deployerJettonWallet.sendTransfer(
            deployer.getSender(),
            toNano("0.1"), //tons
            sentAmount,
            notDeployer.address,
            deployer.address,
            null,
            forwardAmount,
            null,
        )
        expect(sendResult.transactions).toHaveTransaction({
            //excesses
            from: notDeployerJettonWallet.address,
            to: deployer.address,
        })
        expect(sendResult.transactions).toHaveTransaction({
            //notification
            from: notDeployerJettonWallet.address,
            to: notDeployer.address,
            value: forwardAmount,
        })
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
            toNano("0.1"), //tons
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
            exitCode: JettonWallet.errors["Incorrect sender"],
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
            toNano("0.1"), //tons
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
            exitCode: JettonWallet.errors["Incorrect balance after send"],
        })
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance)
        expect(await notDeployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance2)
    })

    it("correctly sends forward_payload in place", async () => {
        const deployerJettonWallet = await userWallet(deployer.address)
        const initialJettonBalance = await deployerJettonWallet.getJettonBalance()
        const notDeployerJettonWallet = await userWallet(notDeployer.address)
        const initialJettonBalance2 = await notDeployerJettonWallet.getJettonBalance()
        const sentAmount = toNano("0.5")
        const forwardAmount = toNano("0.05")
        const forwardPayload = beginCell().storeUint(0x123456789n, 128).endCell()
        //This block checks forward_payload in place (Either bit equals 0)
        const sendResult = await deployerJettonWallet.sendTransfer(
            deployer.getSender(),
            toNano("0.1"), //tons
            sentAmount,
            notDeployer.address,
            deployer.address,
            null,
            forwardAmount,
            forwardPayload,
        )
        expect(sendResult.transactions).toHaveTransaction({
            //excesses
            from: notDeployerJettonWallet.address,
            to: deployer.address,
        })
        /*
        transfer_notification#7362d09c query_id:uint64 amount:(VarUInteger 16)
                                      sender:MsgAddress forward_payload:(Either Cell ^Cell)
                                      = InternalMsgBody;
        */
        expect(sendResult.transactions).toHaveTransaction({
            //notification
            from: notDeployerJettonWallet.address,
            to: notDeployer.address,
            value: forwardAmount,
            body: beginCell()
                .storeUint(JettonMinter.opcodes.JettonNotification, 32)
                .storeUint(0, 64) //default queryId
                .storeCoins(sentAmount)
                .storeAddress(deployer.address)
                .storeSlice(forwardPayload.beginParse()) //Doing this because forward_payload is already Cell with 1 bit 1 and one ref.
                .endCell(),
        })
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(
            initialJettonBalance - sentAmount,
        )
        expect(await notDeployerJettonWallet.getJettonBalance()).toEqual(
            initialJettonBalance2 + sentAmount,
        )
    })

    //There was no such test in official implementation
    it("correctly sends forward_payload in ref", async () => {
        const deployerJettonWallet = await userWallet(deployer.address)
        const initialJettonBalance = await deployerJettonWallet.getJettonBalance()
        const notDeployerJettonWallet = await userWallet(notDeployer.address)
        const initialJettonBalance2 = await notDeployerJettonWallet.getJettonBalance()
        const sentAmount = toNano("0.5")
        const forwardAmount = toNano("0.05")
        //This block checks forward_payload in separate ref (Either bit equals 1)
        const forwardPayload = beginCell()
            .storeUint(1, 1)
            .storeRef(beginCell().storeUint(0x123456789n, 128).endCell())
            .endCell()

        const sendResult = await deployerJettonWallet.sendTransfer(
            deployer.getSender(),
            toNano("0.1"), //tons
            sentAmount,
            notDeployer.address,
            deployer.address,
            null,
            forwardAmount,
            forwardPayload,
        )
        expect(sendResult.transactions).toHaveTransaction({
            //excesses
            from: notDeployerJettonWallet.address,
            to: deployer.address,
        })
        /*
        transfer_notification#7362d09c query_id:uint64 amount:(VarUInteger 16)
                                      sender:MsgAddress forward_payload:(Either Cell ^Cell)
                                      = InternalMsgBody;
        */
        expect(sendResult.transactions).toHaveTransaction({
            //notification
            from: notDeployerJettonWallet.address,
            to: notDeployer.address,
            value: forwardAmount,
            body: beginCell()
                .storeUint(JettonMinter.opcodes.JettonNotification, 32)
                .storeUint(0, 64) //default queryId
                .storeCoins(sentAmount)
                .storeAddress(deployer.address)
                .storeSlice(forwardPayload.beginParse()) //Doing this because forward_payload is already Cell with 1 bit 1 and one ref.
                .endCell(),
        })
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
        const forwardPayload = beginCell().storeUint(0x123456789n, 128).endCell()
        const sendResult = await deployerJettonWallet.sendTransfer(
            deployer.getSender(),
            toNano("0.1"), //tons
            sentAmount,
            notDeployer.address,
            deployer.address,
            null,
            forwardAmount,
            forwardPayload,
        )
        expect(sendResult.transactions).toHaveTransaction({
            //excesses
            from: notDeployerJettonWallet.address,
            to: deployer.address,
        })

        expect(sendResult.transactions).not.toHaveTransaction({
            //no notification
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
        const forwardPayload = beginCell().storeUint(0x123456789n, 128).endCell()
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
            exitCode: JettonWallet.errors["Insufficient amount of TON attached"],
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
    describe("Bounces", () => {
        // This code is borrowed from the stablecoin implementation.
        // The behavior is implementation-defined.
        // I'm still not sure if the code handling these bounces is really necessary,
        // but I could be wrong. Refer to this issue for details: https://github.com/tact-lang/jetton/issues/10
        // This check are 100% necessary if we add an option not to deploy jetton wallet of destination address.
        it("minter should restore supply on internal_transfer bounce", async () => {
            const deployerJettonWallet = await userWallet(deployer.address)
            const mintAmount = BigInt(getRandomInt(1000, 2000))
            const mintMsg = beginCell()
                .store(
                    storeMint({
                        $$type: "Mint",
                        mintMessage: {
                            $$type: "JettonTransferInternal",
                            amount: mintAmount,
                            sender: deployer.address,
                            responseDestination: deployer.address,
                            queryId: 0n,
                            forwardTonAmount: 0n,
                            forwardPayload: beginCell().storeUint(0, 1).asSlice(),
                        },
                        queryId: 0n,
                        receiver: deployer.address,
                        tonAmount: mintAmount,
                    }),
                )
                .endCell()

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
            const firstOutMsg = res.outMessages.get(0)
            if (!firstOutMsg) {
                throw new Error("No out message") // It is impossible due to the check above
            }
            const outMsgSc = firstOutMsg.body.beginParse()
            expect(outMsgSc.preloadUint(32)).toEqual(JettonMinter.opcodes.JettonTransferInternal)

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
            const initRes = await jettonMinter.sendMint(
                deployer.getSender(),
                deployer.address,
                201n,
                0n,
                toNano(1),
            )
            const deployerJettonWallet = await userWallet(deployer.address)
            expect(initRes.transactions).toHaveTransaction({
                from: jettonMinter.address,
                to: deployerJettonWallet.address,
                success: true,
            })

            const notDeployerJettonWallet = await userWallet(notDeployer.address)
            const balanceBefore = await deployerJettonWallet.getJettonBalance()
            const txAmount = BigInt(getRandomInt(100, 200))
            const transferMsg = beginCell()
                .store(
                    storeJettonTransfer({
                        $$type: "JettonTransfer",
                        queryId: 0n,
                        amount: txAmount,
                        responseDestination: deployer.address,
                        destination: notDeployer.address,
                        customPayload: null,
                        forwardTonAmount: 0n,
                        forwardPayload: beginCell().storeUint(0, 1).asSlice(),
                    }),
                )
                .endCell()

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
            const firstOutMsg = res.outMessages.get(0)
            if (!firstOutMsg) {
                throw new Error("No out message") // It is impossible due to the check above
            }
            const outMsgSc = firstOutMsg.body.beginParse()
            expect(outMsgSc.preloadUint(32)).toEqual(JettonMinter.opcodes.JettonTransferInternal)

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
            // Mint some jettons
            await jettonMinter.sendMint(deployer.getSender(), deployer.address, 201n, 0n, toNano(1))
            const deployerJettonWallet = await userWallet(deployer.address)
            const balanceBefore = await deployerJettonWallet.getJettonBalance()
            const burnAmount = BigInt(getRandomInt(100, 200))

            const burnMsg = beginCell()
                .store(
                    storeJettonBurn({
                        $$type: "JettonBurn",
                        queryId: 0n,
                        amount: burnAmount,
                        responseDestination: deployer.address,
                        customPayload: null,
                    }),
                )
                .endCell()

            const walletSmc = await blockchain.getContract(deployerJettonWallet.address)

            const res = await walletSmc.receiveMessage(
                internal({
                    from: deployer.address,
                    to: deployerJettonWallet.address,
                    body: burnMsg,
                    value: toNano("1"),
                }),
            )

            expect(res.outMessagesCount).toEqual(1)
            const firstOutMsg = res.outMessages.get(0)
            if (!firstOutMsg) {
                throw new Error("No out message") // It is impossible due to the check above
            }
            const outMsgSc = firstOutMsg.body.beginParse()
            expect(outMsgSc.preloadUint(32)).toEqual(JettonMinter.opcodes.JettonBurnNotification)

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
            .storeUint(0, 64) //default queryId
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
            exitCode: JettonWallet.errors["Incorrect sender"],
        })
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance)
    })

    it("wallet owner should be able to burn jettons", async () => {
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
            //burn notification
            from: deployerJettonWallet.address,
            to: jettonMinter.address,
        })
        expect(sendResult.transactions).toHaveTransaction({
            //excesses
            from: jettonMinter.address,
            to: deployer.address,
        })
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(
            initialJettonBalance - burnAmount,
        )
        expect(await jettonMinter.getTotalSupply()).toEqual(initialTotalSupply - burnAmount)
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
            exitCode: JettonWallet.errors["Incorrect sender"],
        })
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance)
        expect(await jettonMinter.getTotalSupply()).toEqual(initialTotalSupply)
    })

    it("wallet owner can not burn more jettons than it has", async () => {
        const deployerJettonWallet = await userWallet(deployer.address)
        const initialJettonBalance = await deployerJettonWallet.getJettonBalance()
        const initialTotalSupply = await jettonMinter.getTotalSupply()
        const burnAmount = initialJettonBalance + 1n
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
            exitCode: JettonWallet.errors["Incorrect balance after send"],
        })
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance)
        expect(await jettonMinter.getTotalSupply()).toEqual(initialTotalSupply)
    })

    it("minter should only accept burn messages from jetton wallets", async () => {
        const deployerJettonWallet = await userWallet(deployer.address)
        const burnAmount = toNano("1")
        const burnNotification = (amount: bigint, addr: Address) => {
            return beginCell()
                .storeUint(JettonMinter.opcodes.JettonBurnNotification, 32)
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
            exitCode: JettonMinter.errors["Unauthorized burn"],
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
        expect(discoveryResult.transactions).toHaveTransaction({
            from: jettonMinter.address,
            to: deployer.address,
            body: beginCell()
                .storeUint(JettonMinter.opcodes.TakeWalletAddress, 32)
                .storeUint(0, 64)
                .storeAddress(deployerJettonWallet.address)
                .storeUint(1, 1)
                .storeRef(beginCell().storeAddress(deployer.address).endCell())
                .endCell(),
        })

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
                .storeUint(JettonMinter.opcodes.TakeWalletAddress, 32)
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
                .storeUint(JettonMinter.opcodes.TakeWalletAddress, 32)
                .storeUint(0, 64)
                .storeAddress(notDeployerJettonWallet.address)
                .storeUint(0, 1)
                .endCell(),
        })
    })

    it("Minimal discovery fee", async () => {
        // 5000 gas-units + msg_forward_prices.lump_price + msg_forward_prices.cell_price = 0.0061
        //const fwdFee     = 1464012n;
        //const minimalFee = fwdFee + 10000000n; // toNano('0.0061');

        //Added binary search to find minimal fee
        let L = toNano(0.00000001)
        let R = toNano(0.1)
        //Binary search here does not affect on anything except time of test
        //So if you want to skip it, just replace while(R - L > 1) with while(false) or while(R - L > 1 && false)
        while (R - L > 1) {
            const minimalFee = (L + R) / 2n
            try {
                const discoveryResult = await jettonMinter.sendDiscovery(
                    deployer.getSender(),
                    notDeployer.address,
                    false,
                    minimalFee,
                )
                expect(discoveryResult.transactions).toHaveTransaction({
                    from: deployer.address,
                    to: jettonMinter.address,
                    success: true,
                })
                R = minimalFee
            } catch {
                L = minimalFee
            }
        }
        const minimalFee = L
        let discoveryResult = await jettonMinter.sendDiscovery(
            deployer.getSender(),
            notDeployer.address,
            false,
            minimalFee,
        )
        expect(discoveryResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: jettonMinter.address,
            aborted: true,
            exitCode: JettonMinter.errors["Insufficient gas for discovery"],
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
                .storeUint(JettonMinter.opcodes.TakeWalletAddress, 32)
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
                .storeUint(JettonMinter.opcodes.TakeWalletAddress, 32)
                .storeUint(0, 64)
                .storeUint(0, 2) // addr_none
                .storeUint(1, 1)
                .storeRef(beginCell().storeAddress(badAddr).endCell())
                .endCell(),
        })
    })

    it("Can send even giant payload", async () => {
        const deployerJettonWallet = await userWallet(deployer.address)
        const jwState = (await blockchain.getContract(deployerJettonWallet.address)).account
        const originalBalance = jwState.account!.storage.balance.coins

        jwState.account!.storage.balance.coins = 0n
        await blockchain.setShardAccount(deployerJettonWallet.address, jwState)

        const storeBigPayload = (curBuilder: Builder) => {
            let rootBuilder = curBuilder
            const maxDepth = 5 // Max depth is 5, as 4^5 = 1024 cells, which is quite big payload

            function dfs(builder: Builder, currentDepth: number) {
                if (currentDepth >= maxDepth) {
                    return
                }
                // Cell has a capacity of 1023 bits, so we can store 127 bytes max
                builder.storeBuffer(randomBytes(127))
                // Store all 4 references
                for (let i = 0; i < 4; i++) {
                    let newBuilder = beginCell()
                    dfs(newBuilder, currentDepth + 1)
                    builder.storeRef(newBuilder.endCell())
                }
            }

            dfs(rootBuilder, 0) // Start DFS with depth 0
            return rootBuilder
        }
        const maxPayload = beginCell()
            .storeUint(1, 1) // Store Either bit = 1, as we store payload in ref
            .storeRef(storeBigPayload(beginCell()).endCell()) // Here we generate big payload, to cause high forward fee
            .endCell()

        const sendResult = await deployerJettonWallet.sendTransfer(
            deployer.getSender(),
            toNano("0.2"), // Quite low amount, enough to cover one forward fee but not enough to cover two
            0n,
            notDeployer.address,
            notDeployer.address,
            null,
            2n, // Forward ton amount, that causes bug, described below
            maxPayload,
        )

        // Here we check, that the transaction should bounce on the first jetton wallet
        // Or it should be fully completed

        // However, as we had incorrect logic of forward fee calculation,
        // https://github.com/tact-lang/jetton/issues/58
        // Jetton version with that bug will not be able to send Jetton Notification
        try {
            // Expect that JettonNotify is sent
            expect(sendResult.transactions).toHaveTransaction({
                from: (await userWallet(notDeployer.address)).address,
                to: notDeployer.address,
                success: true,
            })
        } catch {
            // OR that the transaction is bounced on the first jetton wallet
            expect(sendResult.transactions).toHaveTransaction({
                on: deployerJettonWallet.address,
                aborted: true,
            })
        }

        jwState.account!.storage.balance.coins = originalBalance // restore balance
        await blockchain.setShardAccount(deployerJettonWallet.address, jwState)
        expect((await blockchain.getContract(deployerJettonWallet.address)).balance).toEqual(
            originalBalance,
        )
    })

    // This test consume a lot of time: 18 sec
    // and is needed only for measuring ton accruing
    /*it('jettonWallet can process 250 transfer', async () => {
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
            toNano("0.2"), //tons
            sentAmount,
            Address.parse("Ef8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAU"),
            deployer.address,
            null,
            forwardAmount,
            null,
        )
        expect(sendResult.transactions).toHaveTransaction({
            //excesses
            from: deployer.address,
            to: deployerJettonWallet.address,
            aborted: true,
            exitCode: JettonWallet.errors["Not a basechain address"],
        })
    })

    it("Should correctly handle response destination as addr_none", async () => {
        const deployerJettonWallet = await userWallet(deployer.address)

        const burnResult = await deployerJettonWallet.sendBurn(
            deployer.getSender(),
            toNano("0.1"),
            0n,
            deployer.address,
            null,
        )

        expect(burnResult.transactions).toHaveTransaction({
            from: jettonMinter.address,
            to: deployer.address,
        })

        const burnResult2 = await deployerJettonWallet.sendBurn(
            deployer.getSender(),
            toNano("0.1"),
            0n, // Let's burn 0 jettons, it won't affect balance, but we still can check if excesses are sent
            null,
            null,
        )
        expect(burnResult2.transactions).not.toHaveTransaction({
            from: jettonMinter.address,
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
            //excesses
            from: deployerJettonWallet.address,
            to: deployer.address,
        })
        const finalBalance = (await blockchain.getContract(deployer.address)).balance
        const finalWalletBalance = (await blockchain.getContract(deployerJettonWallet.address))
            .balance
        expect(finalWalletBalance).toEqual(minTonsForStorage)
        expect(finalBalance - initialBalance).toBeGreaterThan(toNano("0.99"))
    })
    // implementation detail
    it.skip("not owner can not withdraw excesses", async () => {
        const deployerJettonWallet = await userWallet(deployer.address)
        await deployer.send({value: toNano("1"), bounce: false, to: deployerJettonWallet.address})
        const initialBalance = (await blockchain.getContract(deployer.address)).balance
        const withdrawResult = await deployerJettonWallet.sendWithdrawTons(notDeployer.getSender())
        expect(withdrawResult.transactions).not.toHaveTransaction({
            //excesses
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
            toNano("0.1"), //tons
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
        await deployerJettonWallet.sendWithdrawJettons(
            deployer.getSender(),
            childJettonWallet.address,
            toNano("0.4"),
        )
        expect((await deployerJettonWallet.getJettonBalance()) - initialJettonBalance).toEqual(
            toNano("0.4"),
        )
        expect(await childJettonWallet.getJettonBalance()).toEqual(toNano("0.1"))
        //withdraw the rest
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
            toNano("0.1"), //tons
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
        await deployerJettonWallet.sendWithdrawJettons(
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
