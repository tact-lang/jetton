//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Studio

import {Address, Cell} from "@ton/core"
import type {Blockchain, BlockchainTransaction, SendMessageResult} from "@ton/sandbox"
import chalk from "chalk"
import Table from "cli-table3"

type GasConsumptionChain = {
    type: "chain"
    chainLength?: number // undefined means all transactions in the chain
}

type GasConsumptionSingle = {
    type: "single"
}

type GasConsumption = GasConsumptionChain | GasConsumptionSingle

export function getUsedGasInternal(
    sendResult: SendMessageResult,
    consumptionType: GasConsumption,
): number {
    const lastTxInChainNumber =
        consumptionType.type === "chain"
            ? typeof consumptionType.chainLength === "undefined"
                ? undefined
                : consumptionType.chainLength + 1
            : 2

    return sendResult.transactions
        .slice(1, lastTxInChainNumber)
        .map(t => getComputeGasForTx(t))
        .reduceRight((prev, cur) => prev + cur)
}

export function getComputeGasForTx(tx: BlockchainTransaction) {
    if (tx.description.type === "generic" && tx.description.computePhase.type === "vm") {
        return Number(tx.description.computePhase.gasUsed)
    }

    return 0
}

type BenchmarkResult = {
    label: string
    pr: string | undefined
    gas: Record<string, number>
    summary: number
}

export type RawBenchmarkResult = {
    results: {
        label: string
        pr: string | null
        gas: Record<string, string | undefined>
        summary: string
    }[]
}

export function generateResults(benchmarkResults: RawBenchmarkResult): BenchmarkResult[] {
    return benchmarkResults.results.map(result => ({
        label: result.label,
        pr: result.pr ?? undefined,
        gas: Object.fromEntries(
            Object.entries(result.gas).map(([key, value]) => [key, Number(value)]),
        ),
        summary: Number(result.summary),
    }))
}

export type RawCodeSizeResult = {
    results: {
        label: string
        pr: string | null
        size: Record<string, string>
    }[]
}

type CodeSizeResult = {
    label: string
    pr: string | undefined
    size: Record<string, number>
}

export function generateCodeSizeResults(benchmarkResults: RawCodeSizeResult): CodeSizeResult[] {
    return benchmarkResults.results.map(result => ({
        label: result.label,
        pr: result.pr ?? undefined,
        size: Object.fromEntries(
            Object.entries(result.size).map(([key, value]) => [key, Number(value)]),
        ),
    }))
}

const calculateCellsAndBits = (root: Cell, visited: Set<string> = new Set<string>()) => {
    const hash = root.hash().toString("hex")
    if (visited.has(hash)) {
        return {cells: 0, bits: 0}
    }
    visited.add(hash)

    let cells = 1
    let bits = root.bits.length
    for (const ref of root.refs) {
        const childRes = calculateCellsAndBits(ref, visited)
        cells += childRes.cells
        bits += childRes.bits
    }
    return {cells, bits, visited}
}

export async function getStateSizeForAccount(
    blockchain: Blockchain,
    address: Address,
): Promise<{cells: number; bits: number}> {
    const accountState = (await blockchain.getContract(address)).accountState
    if (!accountState || accountState.type !== "active") {
        throw new Error("Account state not found")
    }
    if (!accountState.state.code || !accountState.state.data) {
        throw new Error("Account state code or data not found")
    }
    const accountCode = accountState.state.code
    const accountData = accountState.state.data
    // There probably won't be the same cells in both code and data, but still it's fairer to take that into account
    const codeSize = calculateCellsAndBits(accountCode)
    const dataSize = calculateCellsAndBits(accountData, codeSize.visited)

    return {
        cells: codeSize.cells + dataSize.cells,
        bits: codeSize.bits + dataSize.bits,
    }
}

export function getSizeOfState(arg: {code: Cell; data: Cell}) {
    // There probably won't be the same cells in both code and data, but still it's fairer to take that into account
    const codeSize = calculateCellsAndBits(arg.code)
    const dataSize = calculateCellsAndBits(arg.data, codeSize.visited)

    return {
        cells: codeSize.cells + dataSize.cells,
        bits: codeSize.bits + dataSize.bits,
    }
}

function calculateChange(prev: number, curr: number): string {
    const change = (((curr - prev) / prev) * 100).toFixed(2)
    const number = parseFloat(change)
    if (number === 0) {
        return chalk.gray(`same`)
    }

    if (Number.isNaN(number)) {
        if (typeof prev === "undefined" && typeof curr !== "undefined") {
            return chalk.greenBright(`(new)`)
        }
        return ""
    }

    return number >= 0 ? chalk.redBright(`(+${change}%)`) : chalk.green(`(${change}%)`)
}

function calculateChanges<
    T extends {gas?: Record<string, number>; size?: Record<string, number>; summary?: number},
>(results: T[], metrics: readonly string[], type: "gas" | "size"): string[][] {
    return results.reduce<string[][]>((changes, currentResult, index) => {
        if (index === 0) {
            return [metrics.map(() => "")]
        }

        const previousResult = results.at(index - 1)
        const rowChanges =
            typeof previousResult !== "undefined"
                ? metrics.map(metric =>
                      calculateChange(
                          previousResult[type]![metric]!,
                          currentResult[type]![metric]!,
                      ),
                  )
                : []

        return [...changes, rowChanges]
    }, [])
}

function calculateSummaryChanges<T extends {summary?: number}>(results: T[]): string[] {
    return results.reduce<string[]>((changes, currentResult, index) => {
        if (index === 0) {
            return [""]
        }

        const previousResult = results.at(index - 1)
        const change =
            typeof previousResult !== "undefined"
                ? calculateChange(previousResult.summary!, currentResult.summary!)
                : ""

        return [...changes, change]
    }, [])
}

type BenchmarkTableArgs = {
    implementationName: string
    printMode: "first-last" | "full" | "last-diff"
}

function createTable<
    T extends {
        gas?: Record<string, number>
        size?: Record<string, number>
        summary?: number
        label: string
        pr?: string
    },
>(results: T[], metrics: readonly string[], type: "gas" | "size"): string {
    const table = new Table({
        head: ["Run", ...metrics, "Summary", "PR #"],
        style: {
            head: ["cyan"],
            border: ["gray"],
        },
    })

    const changes = calculateChanges(results, metrics, type)
    const summaryChanges = calculateSummaryChanges(results)

    results
        .map(({label, [type]: data, summary, pr: commit}, i) => [
            label,
            ...metrics.map((metric, j) => `${data![metric] ?? "-"} ${changes[i]?.[j]}`),
            `${summary} ${summaryChanges[i]}`,
            commit
                ? commit.substring(commit.lastIndexOf("/") + 1, commit.lastIndexOf("/") + 8)
                : "-",
        ])
        .forEach(arr => {
            table.push(arr)
        })

    return table.toString()
}

const handleTablePrintMode = (results: BenchmarkResult[], arg: BenchmarkTableArgs) => {
    switch (arg.printMode) {
        case "first-last":
            return [results.at(0)!, results.at(-1)!]
        case "full":
            return results
        case "last-diff":
            return results.slice(results.length - 2)
    }
}

export function printBenchmarkTable(
    results: BenchmarkResult[],
    codeSizeResults: CodeSizeResult[] | undefined,
    args: BenchmarkTableArgs,
): void {
    if (typeof process.env.PRINT_TABLE === "undefined" || process.env.PRINT_TABLE === "false") {
        return
    }

    const METRICS: readonly string[] = Object.keys(results.at(-1)!.gas)
    const first = results.at(0)!
    const last = results.at(-1)!

    const tableResults = handleTablePrintMode(results, args)

    if (tableResults.length === 0) {
        console.log("No benchmark results to display.")
        return
    }

    const gasTable = createTable(tableResults, METRICS, "gas")

    const output = []
    output.push("Gas Usage Results:")
    output.push(gasTable)

    if (typeof codeSizeResults !== "undefined") {
        const codeSizeMetrics = Object.keys(codeSizeResults[0]!.size)

        const codeSizeTable = createTable(codeSizeResults, codeSizeMetrics, "size")

        output.push("\nCode Size Results:")
        output.push(codeSizeTable)
    }

    output.push(`\nComparison with ${args.implementationName} implementation:`)
    output.push(
        ...METRICS.map(metric => {
            const ratio = (Number(last.gas[metric]) / Number(first.gas[metric])) * 100

            const metricNumber = Number.isNaN(ratio) ? "new!" : `${ratio.toFixed(2)}%`

            return `${metric.charAt(0).toUpperCase() + metric.slice(1)}: ${
                ratio > 100 ? chalk.redBright(metricNumber) : chalk.green(metricNumber)
            } of ${args.implementationName} gas usage`
        }),
    )

    console.log(output.join("\n"))
}
