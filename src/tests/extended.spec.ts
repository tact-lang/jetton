import {Address, beginCell, Cell, toNano} from "@ton/core"
import {Blockchain, SandboxContract, TreasuryContract} from "@ton/sandbox"
import {ExtendedJettonWallet} from "../wrappers/ExtendedJettonWallet"
import {ExtendedJettonMinter} from "../wrappers/ExtendedJettonMinter"

import {JettonUpdateContent, CloseMinting, Mint, JettonMinter} from "../output/Jetton_JettonMinter"

import "@ton/test-utils"

// this test suite includes tests for the extended functionality
describe("Jetton Minter Extended", () => {
    let blockchain: Blockchain
    let jettonMinter: SandboxContract<ExtendedJettonMinter>
    let jettonWallet: SandboxContract<ExtendedJettonWallet>
    let deployer: SandboxContract<TreasuryContract>

    let _jwallet_code = new Cell()
    let _minter_code = new Cell()
    let notDeployer: SandboxContract<TreasuryContract>

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    let userWallet: (address: Address) => Promise<SandboxContract<ExtendedJettonWallet>>
    let defaultContent: Cell
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

    it("Can close minting", async () => {
        const closeMinting: CloseMinting = {
            $$type: "CloseMinting",
        }
        const unsuccessfulCloseMinting = await jettonMinter.send(
            notDeployer.getSender(),
            {value: toNano("0.1")},
            closeMinting,
        )
        expect(unsuccessfulCloseMinting.transactions).toHaveTransaction({
            from: notDeployer.address,
            to: jettonMinter.address,
            aborted: true,
            exitCode: JettonMinter.errors["Incorrect sender"],
        })
        expect((await jettonMinter.getGetJettonData()).mintable).toBeTruthy()

        const successfulCloseMinting = await jettonMinter.send(
            deployer.getSender(),
            {value: toNano("0.1")},
            closeMinting,
        )
        expect(successfulCloseMinting.transactions).toHaveTransaction({
            from: deployer.address,
            to: jettonMinter.address,
            success: true,
        })
        expect((await jettonMinter.getGetJettonData()).mintable).toBeFalsy()

        const mintMsg: Mint = {
            $$type: "Mint",
            queryId: 0n,
            receiver: deployer.address,
            tonAmount: toNano("0.1"),
            mintMessage: {
                $$type: "JettonTransferInternal",
                queryId: 0n,
                amount: toNano("0.1"),
                sender: deployer.address,
                responseDestination: deployer.address,
                forwardPayload: beginCell().storeUint(0, 1).endCell().asSlice(),
                forwardTonAmount: 0n,
            },
        }
        const mintTryAfterClose = await jettonMinter.send(
            deployer.getSender(),
            {value: toNano("0.1")},
            mintMsg,
        )
        expect(mintTryAfterClose.transactions).toHaveTransaction({
            from: deployer.address,
            to: jettonMinter.address,
            aborted: true,
            exitCode: JettonMinter.errors["Mint is closed"],
        })
    })
})
