import {Address, beginCell, Cell, toNano} from "@ton/core"
import {Blockchain, BlockchainSnapshot, SandboxContract, TreasuryContract} from "@ton/sandbox"
import {randomAddress} from "@ton/test-utils"

import {JettonUpdateContent} from "../../output/Jetton_JettonMinter"
import {ExtendedFeatureRichJettonMinter} from "../../wrappers/ExtendedFeatureRichJettonMinter"
import {ExtendedFeatureRichJettonWallet} from "../../wrappers/ExtendedFeatureRichJettonWallet"

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

        const sendAllJettonsResult = await deployerJettonWallet.sendTransferAllJettons(
            deployer.getSender(),
            toNano("0.1"), // tons
            randomNewReceiver,
            deployer.address,
            0n,
            null,
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
})
