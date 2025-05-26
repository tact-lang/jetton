import {Address, beginCell, Cell, toNano} from "@ton/core"
import {Blockchain, BlockchainSnapshot, SandboxContract, TreasuryContract} from "@ton/sandbox"
import "@ton/test-utils"

import {JettonUpdateContent, prefixLength} from "../../output/Shard_JettonMinterSharded"
import {ExtendedShardedJettonMinter} from "../../wrappers/ExtendedShardedJettonMinter"
import {ExtendedShardedJettonWallet} from "../../wrappers/ExtendedShardedJettonWallet"

// this is test suite for shard jetton minter
describe("Shard Jetton Minter", () => {
    let blockchain: Blockchain
    let jettonMinter: SandboxContract<ExtendedShardedJettonMinter>
    let deployer: SandboxContract<TreasuryContract>

    let userWallet: (address: Address) => Promise<SandboxContract<ExtendedShardedJettonWallet>>
    let defaultContent: Cell
    let snapshot: BlockchainSnapshot
    beforeAll(async () => {
        blockchain = await Blockchain.create()
        deployer = await blockchain.treasury("deployer")

        defaultContent = beginCell().endCell()
        const msg: JettonUpdateContent = {
            $$type: "JettonUpdateContent",
            queryId: 0n,
            content: defaultContent,
        }

        jettonMinter = blockchain.openContract(
            await ExtendedShardedJettonMinter.fromInit(0n, deployer.address, defaultContent),
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
                new ExtendedShardedJettonWallet(await jettonMinter.getGetWalletAddress(address)),
            )
        }

        snapshot = blockchain.snapshot()
    })

    beforeEach(async () => {
        await blockchain.loadFrom(snapshot)
    })

    it("should deploy in the same shard", async () => {
        const wallet = await userWallet(deployer.address)
        const walletHash = BigInt("0x" + wallet.address.hash.toString("hex"))
        const deployerHash = BigInt("0x" + deployer.address.hash.toString("hex"))
        expect(walletHash >> BigInt(256n - prefixLength)).toBe(
            deployerHash >> BigInt(256n - prefixLength),
        ) // compare only first prefixLength bits
    })
})
