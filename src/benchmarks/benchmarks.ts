import {strict as assert} from "assert"

import {generateResults, printBenchmarkTable} from "../utils/gas"
import benchmarkResults from "./results_gas.json"
import {
    runTransferBenchmark,
    runMintBenchmark,
    runBurnBenchmark,
    runDiscoveryBenchmark,
} from "./environment"

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

    assert.equal(
        gasUsedForTransfer + gasUsedForMint + gasUsedForBurn + gasUsedForDiscovery,
        expectedResult.summary,
    )

    if (process.env.PRINT_TABLE === "true") {
        printBenchmarkTable(results, undefined, {
            implementationName: "Tact Jetton",
            printMode: "full",
        })
    }
}

void main()
