import {Blockchain} from "@ton/sandbox"
import {JettonUpdateContent} from "../output/Jetton_JettonMinter"
import {Address, beginCell, Cell, toNano} from "@ton/core"
import {assertTransactionChainWasSuccessful, assertWasDeployed} from "../utils/assert"
import {ExtendedJettonMinter} from "../wrappers/ExtendedJettonMinter"
import {ExtendedJettonWallet} from "../wrappers/ExtendedJettonWallet"
import {getUsedGasInternal} from "../utils/gas"

const DEFAULT_MINTER_CONTENT = beginCell().endCell()

const UPDATE_MINTER_CONTENT_MSG: JettonUpdateContent = {
    $$type: "JettonUpdateContent",
    queryId: 0n,
    content: new Cell(),
}

const initializeJettonEnvironment = async () => {
    const blockchain = await Blockchain.create()

    const deployer = await blockchain.treasury("deployer")
    const notDeployer = await blockchain.treasury("notDeployer")

    const jettonMinter = blockchain.openContract(
        await ExtendedJettonMinter.fromInit(0n, deployer.address, DEFAULT_MINTER_CONTENT),
    )

    const deployResult = await jettonMinter.send(
        deployer.getSender(),
        {value: toNano("0.1")},
        UPDATE_MINTER_CONTENT_MSG,
    )

    assertWasDeployed(deployResult.transactions, {
        deployerAddress: deployer.address,
        deployedContractAddress: jettonMinter.address,
    })

    const initSnapshot = blockchain.snapshot()

    return async () => {
        await blockchain.loadFrom(initSnapshot)

        return {
            blockchain,
            deployer,
            notDeployer,
            jettonMinter,
            getJettonWallet: async (address: Address) => {
                return blockchain.openContract(
                    new ExtendedJettonWallet(await jettonMinter.getGetWalletAddress(address)),
                )
            },
        }
    }
}

const loadJettonEnvironment = initializeJettonEnvironment()

const lengthEqualsEither = (either: number, or: number) => (chainLength: number) =>
    chainLength === either || chainLength === or

export const runTransferBenchmark = async () => {
    const {deployer, jettonMinter, getJettonWallet} = await loadJettonEnvironment.then(v => v())

    const mintResult = await jettonMinter.sendMint(
        deployer.getSender(),
        deployer.address,
        toNano(100000),
        toNano("0.1"),
        toNano("1"),
    )

    // external -> mint -> transfer internal -> excesses <could fail> + notification
    assertTransactionChainWasSuccessful(mintResult.transactions, lengthEqualsEither(4, 5))

    const deployerWallet = await getJettonWallet(deployer.address)
    const someAddress = Address.parse("EQD__________________________________________0vo")

    const transferResult = await deployerWallet.sendTransfer(
        deployer.getSender(),
        toNano(1),
        1n,
        someAddress,
        deployer.address,
        null,
        0n,
        null,
    )

    // external -> transfer -> transfer internal -> excesses <could fail>
    assertTransactionChainWasSuccessful(transferResult.transactions, lengthEqualsEither(3, 4))

    // benchmark [transfer -> transfer internal]
    return getUsedGasInternal(transferResult, {type: "chain", chainLength: 2})
}

export const runMintBenchmark = async () => {
    const {deployer, jettonMinter} = await loadJettonEnvironment.then(v => v())

    const mintResult = await jettonMinter.sendMint(
        deployer.getSender(),
        deployer.address,
        toNano(100000),
        toNano("0.1"),
        toNano("1"),
    )

    // external -> mint -> transfer internal -> excesses <could fail> + notification
    assertTransactionChainWasSuccessful(mintResult.transactions, lengthEqualsEither(4, 5))

    // benchmark [mint -> transfer internal]
    return getUsedGasInternal(mintResult, {type: "chain", chainLength: 2})
}

export const runBurnBenchmark = async () => {
    const {deployer, jettonMinter, getJettonWallet} = await loadJettonEnvironment.then(v => v())

    const mintResult = await jettonMinter.sendMint(
        deployer.getSender(),
        deployer.address,
        toNano(100000),
        toNano("0.1"),
        toNano("1"),
    )

    assertTransactionChainWasSuccessful(mintResult.transactions, lengthEqualsEither(4, 5))

    const deployerWallet = await getJettonWallet(deployer.address)

    const burnResult = await deployerWallet.sendBurn(
        deployer.getSender(),
        toNano(1),
        1n,
        deployer.address,
        null,
    )

    // external -> burn -> burn notification -> excesses <could fail>
    assertTransactionChainWasSuccessful(burnResult.transactions, lengthEqualsEither(3, 4))

    // benchmark [burn -> burn notification]
    return getUsedGasInternal(burnResult, {type: "chain", chainLength: 2})
}

export const runDiscoveryBenchmark = async () => {
    const {deployer, jettonMinter} = await loadJettonEnvironment.then(v => v())

    const discoveryResult = await jettonMinter.sendDiscovery(
        deployer.getSender(),
        deployer.address,
        true,
        toNano("0.1"),
    )

    // external -> discovery -> provide
    assertTransactionChainWasSuccessful(discoveryResult.transactions, (l: number) => l === 3)

    return getUsedGasInternal(discoveryResult, {type: "single"})
}
