//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Studio

import {strict as assert} from "assert"

import {generateResults, printBenchmarkTable} from "../utils/gas"
import benchmarkResults from "./results_gas.json"
import {
    runTransferBenchmarkWithForwardPayload,
    runTransferBenchmarkWithoutForwardPayload,
    runMintBenchmark,
    runBurnBenchmark,
    runDiscoveryBenchmark,
    runReportBalanceBenchmark,
    runClaimTonBenchmark,
} from "./environment"

const main = async () => {
    const results = generateResults(benchmarkResults)
    const expectedResult = results.at(-1)!

    const gasUsedForTransferWithFwd = await runTransferBenchmarkWithForwardPayload()
    const gasUsedForTransferWithoutFwd = await runTransferBenchmarkWithoutForwardPayload()
    const gasUsedForTransfer = gasUsedForTransferWithFwd + gasUsedForTransferWithoutFwd
    assert.equal(gasUsedForTransfer, expectedResult.gas["transfer"])

    const gasUsedForMint = await runMintBenchmark()
    assert.equal(gasUsedForMint, expectedResult.gas["mint"])

    const gasUsedForBurn = await runBurnBenchmark()
    assert.equal(gasUsedForBurn, expectedResult.gas["burn"])

    const gasUsedForDiscovery = await runDiscoveryBenchmark()
    assert.equal(gasUsedForDiscovery, expectedResult.gas["discovery"])

    const gasUsedForReportBalance = await runReportBalanceBenchmark()
    assert.equal(gasUsedForReportBalance, expectedResult.gas["reportBalance"])

    const gasUsedForTonClaim = await runClaimTonBenchmark()
    assert.equal(gasUsedForTonClaim, expectedResult.gas["claimWallet"])

    assert.equal(
        gasUsedForTransfer +
            gasUsedForMint +
            gasUsedForBurn +
            gasUsedForDiscovery +
            gasUsedForReportBalance +
            gasUsedForTonClaim,
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
