//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Studio

import {strict as assert} from "assert"
import {Address, Cell, AccountStatus, ContractABI, fromNano} from "@ton/core"
import chalk from "chalk"
import {BlockchainTransaction} from "@ton/sandbox"
import {flattenTransaction, FlatTransaction} from "@ton/test-utils"

type FlatTransactionValue =
    | number
    | bigint
    | boolean
    | Address
    | Cell
    | AccountStatus
    | [number, bigint][]
    | undefined

type FlatPrintLevels = "info" | "extended" | "raw"

type FlatPrintParameters = {
    abi?: ContractABI
    level?: FlatPrintLevels
}

const PRINT_LEVEL_KEYS: Record<FlatPrintLevels, Array<keyof FlatTransaction>> = {
    info: ["from", "to", "value", "success", "op", "exitCode"],
    extended: [
        "from",
        "to",
        "value",
        "inMessageBounced",
        "inMessageBounceable",
        "op",
        "deploy",
        "lt",
        "now",
        "outMessagesCount",
        "endStatus",
        "oldStatus",
        "totalFees",
        "aborted",
        "destroyed",
        "exitCode",
        "actionResultCode",
        "success",
    ],
    raw: [
        "from",
        "to",
        "value",
        "body",
        "inMessageBounced",
        "inMessageBounceable",
        "initData",
        "initCode",
        "op",
        "deploy",
        "lt",
        "now",
        "outMessagesCount",
        "endStatus",
        "oldStatus",
        "totalFees",
        "aborted",
        "destroyed",
        "exitCode",
        "actionResultCode",
        "success",
    ],
}

function getPrettyTx(tx: Partial<FlatTransaction>, args?: FlatPrintParameters): string {
    const level = args?.level ?? "info"
    const keys = PRINT_LEVEL_KEYS[level]

    const replacer = (key: string, value: FlatTransactionValue) => {
        // The initial call returns the whole object with an empty key
        if (key === "") {
            return value
        }

        const flatTxKey = key as keyof FlatTransaction

        if (!keys.includes(flatTxKey)) {
            return undefined // skip
        }

        if (
            flatTxKey === "exitCode" &&
            typeof value === "number" &&
            args?.abi?.errors &&
            value !== 0
        ) {
            return args.abi.errors[value].message ?? value.toString()
        }

        if (flatTxKey === "op" && typeof value === "number" && args?.abi?.types) {
            const header = args.abi.types.find(type => type.header === value)
            return header?.name ?? value.toString()
        }

        if (value instanceof Address) {
            return value.toString()
        }

        if (value instanceof Cell) {
            return value.toString()
        }

        if (typeof value === "bigint") {
            if (flatTxKey === "lt") {
                return value.toString()
            }

            return fromNano(value.toString())
        }

        return value
    }

    return JSON.stringify(tx, replacer, 2)
}

export function printTransaction(tx: BlockchainTransaction, args?: FlatPrintParameters) {
    console.log(getPrettyTx(flattenTransaction(tx), args))
}

function compareTransactionValues(a: FlatTransactionValue, b: FlatTransactionValue): boolean {
    if (typeof a === "undefined" || typeof b === "undefined") {
        return a === b
    }

    if (a instanceof Address) {
        return b instanceof Address && a.equals(b)
    }
    if (a instanceof Cell) {
        return b instanceof Cell && a.equals(b)
    }

    return a === b
}

// Find the transaction with the most matching fields for pretty assertion message
function findClosestTxMatch(
    transactions: Partial<FlatTransaction>[],
    criteria: Partial<FlatTransaction>,
) {
    let bestMatch: Partial<FlatTransaction> | undefined
    let bestMatchCount = 0

    for (const tx of transactions) {
        let matchCount = 0
        for (const key of getTypedObjectKeys(criteria)) {
            if (compareTransactionValues(criteria[key], tx[key])) {
                matchCount++
            }
        }

        if (matchCount > bestMatchCount) {
            bestMatch = tx
            bestMatchCount = matchCount
        }
    }

    return bestMatch
}

const getTypedObjectKeys = <T extends object>(obj: T) => {
    return Object.keys(obj) as Array<keyof T>
}

function compareTransaction(
    targetTx: Partial<FlatTransaction>,
    cmpTx: Partial<FlatTransaction>,
): boolean {
    for (const key of getTypedObjectKeys(cmpTx)) {
        // we allow the comparison object to be a partial, while the target object must contain all partial keys
        if (!(key in targetTx)) {
            throw new Error(`Unknown flat transaction object key ${key}`)
        }

        const targetTxValue = targetTx[key]
        const cmpTxValue = cmpTx[key]
        if (!compareTransactionValues(targetTxValue, cmpTxValue)) {
            return false
        }
    }
    return true
}

export function assertTransaction(
    transactions: BlockchainTransaction[],
    criteria: Partial<FlatTransaction>,
) {
    const matchingTransaction = transactions.find(tx =>
        compareTransaction(flattenTransaction(tx), criteria),
    )

    if (typeof matchingTransaction === "undefined") {
        const closestTx = findClosestTxMatch(transactions.map(flattenTransaction), criteria)

        if (typeof closestTx === "undefined") {
            assert(
                typeof matchingTransaction !== "undefined",
                `No transaction found matching criteria:\n ${getPrettyTx(criteria)}`,
            )
        }

        const diffLines = []
        diffLines.push("Difference:")

        for (const key of getTypedObjectKeys(criteria)) {
            if (!compareTransactionValues(criteria[key], closestTx![key])) {
                diffLines.push(chalk.dim(`  ${key}: {`))
                diffLines.push(`    Expected  ${chalk.green(closestTx![key])}`)
                diffLines.push(`    Received  ${chalk.red(criteria[key])}`)
                diffLines.push(chalk.dim("  }"))
            }
        }

        const prettyClosestTx = chalk.dim(getPrettyTx(closestTx!))

        assert(
            typeof matchingTransaction !== "undefined",
            `Transaction does not match criteria. Closest match:\n${prettyClosestTx} \n${diffLines.join("\n")}`,
        )
    }
}

export function assertTransactionChainWasSuccessful(
    transactions: BlockchainTransaction[],
    chainLengthPredicate: (len: number) => boolean,
) {
    assert(
        chainLengthPredicate(transactions.length),
        `Tx chain length check failed, got ${transactions.length}`,
    )
    const failedTxAmount = transactions.map(flattenTransaction).filter(tx => !tx.success).length

    assert(
        chainLengthPredicate(transactions.length - failedTxAmount),
        `Not all transactions in the chain were successful. Failed transactions:\n ${transactions
            .map(flattenTransaction)
            .filter(tx => !tx.success)
            .map(v => getPrettyTx(v))
            .join("\n")}`,
    )
}

export function assertWasDeployed(
    transactions: BlockchainTransaction[],
    args: {
        deployerAddress?: Address
        deployedContractAddress?: Address
    },
) {
    assertTransaction(transactions, {
        from: args.deployerAddress,
        to: args.deployedContractAddress,
        deploy: true,
        // don't assert "success: true" here, as the deploy transaction might be aborted
    })
}
