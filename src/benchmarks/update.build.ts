//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Studio

import {createInterface} from "readline/promises"
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
import {writeFile} from "fs/promises"
import {join} from "path"
import {generateResults, printBenchmarkTable} from "../utils/gas"
import chalk from "chalk"

const readInput = async () => {
    const readline = createInterface({
        input: process.stdin,
        output: process.stdout,
    })

    const label = await readline.question(`Benchmark label: `)
    const prNumber = await readline.question("PR number: ")

    readline.close()

    return {label, prNumber}
}

const main = async () => {
    const isUpdate = process.env.UPDATE === "true"

    const expectedResult = benchmarkResults.results.at(-1)!

    const data = isUpdate
        ? {label: expectedResult.label, prNumber: expectedResult.pr}
        : await readInput()

    const gasUsedForTransfer =
        (await runTransferBenchmarkWithForwardPayload()) +
        (await runTransferBenchmarkWithoutForwardPayload())
    const gasUsedForMint = await runMintBenchmark()
    const gasUsedForBurn = await runBurnBenchmark()
    const gasUsedForDiscovery = await runDiscoveryBenchmark()
    const gasUsedForReportBalance = await runReportBalanceBenchmark()
    const gasUsedForClaimTon = await runClaimTonBenchmark()

    const newBenchmarkResult = {
        label: data.label,
        pr: data.prNumber,
        gas: {
            transfer: gasUsedForTransfer.toString(),
            mint: gasUsedForMint.toString(),
            burn: gasUsedForBurn.toString(),
            discovery: gasUsedForDiscovery.toString(),
            reportBalance: gasUsedForReportBalance.toString(),
            claimWallet: gasUsedForClaimTon.toString(),
        },
        summary: String(
            gasUsedForTransfer +
                gasUsedForMint +
                gasUsedForBurn +
                gasUsedForDiscovery +
                gasUsedForReportBalance +
                gasUsedForClaimTon,
        ),
    }

    if (isUpdate) {
        console.log(chalk.yellow("Updated benchmark results!\n"))
        expectedResult.gas = newBenchmarkResult.gas
        expectedResult.summary = newBenchmarkResult.summary
    } else {
        console.log(chalk.yellow("Added new entry to benchmark results!\n"))
        benchmarkResults.results.push(newBenchmarkResult)
    }

    const results = generateResults(benchmarkResults)
    printBenchmarkTable(results, undefined, {
        implementationName: "Base-Tact-Jetton",
        printMode: "last-diff",
    })

    await writeFile(
        join(__dirname, "results_gas.json"),
        JSON.stringify(benchmarkResults, null, 4) + "\n",
    )
}

void main()
