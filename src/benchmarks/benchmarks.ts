import {strict as assert} from "assert"
import {Blockchain} from "@ton/sandbox"
import {JettonUpdateContent} from "../output/Jetton_JettonMinter"
import {Address, beginCell, Cell, toNano} from "@ton/core"
import {
    assertTransactionChainSuccessfull,
    assertTransactionChainSuccessfullEither,
    assertWasDeployed,
} from "../utils/assert"
import {ExtendedJettonMinter} from "../wrappers/ExtendedJettonMinter"
import {ExtendedJettonWallet} from "../wrappers/ExtendedJettonWallet"
import {generateResults, getUsedGasInternal, printBenchmarkTable} from "../utils/gas"
import benchmarkResults from "./results_gas.json"

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

const runTransferBenchmark = async () => {
    const {deployer, jettonMinter, getJettonWallet} = await initializeJettonEnvironment()

    const mintResult = await jettonMinter.sendMint(
        deployer.getSender(),
        deployer.address,
        toNano(100000),
        toNano("0.1"),
        toNano("1"),
    )

    // external -> mint -> transfer internal -> excesses <could fail> + notification
    assertTransactionChainSuccessfullEither(mintResult.transactions, {
        either: 4,
        or: 5,
    })

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
    assertTransactionChainSuccessfullEither(transferResult.transactions, {
        either: 3,
        or: 4,
    })

    // benchmark [transfer -> transfer internal]
    return getUsedGasInternal(transferResult, {type: "chain", chainLength: 2})
}

const runMintBenchmark = async () => {
    const {deployer, jettonMinter} = await initializeJettonEnvironment()

    const mintResult = await jettonMinter.sendMint(
        deployer.getSender(),
        deployer.address,
        toNano(100000),
        toNano("0.1"),
        toNano("1"),
    )

    // external -> mint -> transfer internal -> excesses <could fail> + notification
    assertTransactionChainSuccessfullEither(mintResult.transactions, {
        either: 4,
        or: 5,
    })

    // benchmark [mint -> transfer internal]
    return getUsedGasInternal(mintResult, {type: "chain", chainLength: 2})
}

const runBurnBenchmark = async () => {
    const {deployer, jettonMinter, getJettonWallet} = await initializeJettonEnvironment()

    const mintResult = await jettonMinter.sendMint(
        deployer.getSender(),
        deployer.address,
        toNano(100000),
        toNano("0.1"),
        toNano("1"),
    )

    assertTransactionChainSuccessfullEither(mintResult.transactions, {
        either: 4,
        or: 5,
    })

    const deployerWallet = await getJettonWallet(deployer.address)

    const burnResult = await deployerWallet.sendBurn(
        deployer.getSender(),
        toNano(1),
        1n,
        deployer.address,
        null,
    )

    // external -> burn -> burn notification -> excesses <could fail>
    assertTransactionChainSuccessfullEither(burnResult.transactions, {
        either: 3,
        or: 4,
    })

    // benchmark [burn -> burn notification]
    return getUsedGasInternal(burnResult, {type: "chain", chainLength: 2})
}

const runDiscoveryBenchmark = async () => {
    const {deployer, jettonMinter} = await initializeJettonEnvironment()

    const discoveryResult = await jettonMinter.sendDiscovery(
        deployer.getSender(),
        deployer.address,
        true,
        toNano("0.1"),
    )

    // external -> discovery -> provide
    assertTransactionChainSuccessfull(discoveryResult.transactions, 3)

    return getUsedGasInternal(discoveryResult, {type: "single"})
}

const main = async () => {
    const results = generateResults(benchmarkResults)
    const expectedResult = results.at(-1)!

    const gasUsedForTransfer = await runTransferBenchmark()
    assert.equal(gasUsedForTransfer, expectedResult.gas["transfer"])

    const gasUsedForMint = await runMintBenchmark()
    assert.equal(gasUsedForMint, expectedResult.gas["mint"])

    const gasUsedForBurn = await runBurnBenchmark()
    assert.equal(gasUsedForBurn, expectedResult.gas["burn"])

    const gasUsedForDiscovery = await runDiscoveryBenchmark()
    assert.equal(gasUsedForDiscovery, expectedResult.gas["discovery"])

    printBenchmarkTable(results, undefined, {
        implementationName: "Tact Jetton",
        printMode: "full",
    })
}

void main()
