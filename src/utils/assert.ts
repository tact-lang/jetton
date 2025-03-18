import {strict as assert} from "assert"
import {Address, Cell, AccountStatus, ContractABI, fromNano} from "@ton/core"
import {BlockchainTransaction} from "@ton/sandbox/dist/blockchain/Blockchain"
import chalk from "chalk"

type FlatTransaction = {
    readonly from?: Address
    readonly to?: Address
    readonly value?: bigint
    readonly body?: Cell
    readonly inMessageBounced?: boolean
    readonly inMessageBounceable?: boolean
    readonly op?: number
    readonly initData?: Cell
    readonly initCode?: Cell
    readonly deploy?: boolean
    readonly lt?: bigint
    readonly now?: number
    readonly outMessagesCount?: number
    readonly statusBefore?: AccountStatus
    readonly statusAfter?: AccountStatus
    readonly totalFees?: bigint
    readonly aborted?: boolean
    readonly destroyed?: boolean
    readonly exitCode?: number
    readonly actionResultCode?: number
    readonly success?: boolean
}

type FlatTransactionValue = number | bigint | boolean | Address | Cell | AccountStatus | undefined

const extractOp = (body: Cell) => {
    const s = body.beginParse()
    return s.remainingBits >= 32 ? s.loadUint(32) : undefined
}

function flattenTransaction(tx: BlockchainTransaction): FlatTransaction {
    if (tx === undefined) {
        throw new Error("Transaction is undefined")
    }

    return {
        from: tx.inMessage?.info.src instanceof Address ? tx.inMessage.info.src : undefined,
        to: tx.inMessage?.info.dest instanceof Address ? tx.inMessage.info.dest : undefined,
        value: tx.inMessage?.info.type === "internal" ? tx.inMessage.info.value.coins : undefined,
        body: tx.inMessage?.body,
        inMessageBounced:
            tx.inMessage?.info.type === "internal" ? tx.inMessage.info.bounced : undefined,
        inMessageBounceable:
            tx.inMessage?.info.type === "internal" ? tx.inMessage.info.bounce : undefined,
        op: tx.inMessage?.body ? extractOp(tx.inMessage.body) : undefined,
        initData: tx.inMessage?.init?.data ?? undefined,
        initCode: tx.inMessage?.init?.code ?? undefined,
        deploy: tx.inMessage?.init ? tx.oldStatus !== "active" && tx.endStatus === "active" : false,
        lt: tx.lt,
        now: tx.now,
        outMessagesCount: tx.outMessagesCount,
        statusBefore: tx.oldStatus,
        statusAfter: tx.endStatus,
        totalFees: tx.totalFees.coins,
        aborted:
            tx.description.type === "generic" ||
            tx.description.type === "tick-tock" ||
            tx.description.type === "split-prepare" ||
            tx.description.type === "merge-install"
                ? tx.description.aborted
                : undefined,
        destroyed:
            tx.description.type === "generic" ||
            tx.description.type === "tick-tock" ||
            tx.description.type === "split-prepare" ||
            tx.description.type === "merge-install"
                ? tx.description.destroyed
                : undefined,
        exitCode:
            tx.description.type === "generic" ||
            tx.description.type === "tick-tock" ||
            tx.description.type === "split-prepare" ||
            tx.description.type === "merge-install"
                ? tx.description.computePhase.type === "vm"
                    ? tx.description.computePhase.exitCode
                    : undefined
                : undefined,
        actionResultCode:
            tx.description.type === "generic" ||
            tx.description.type === "tick-tock" ||
            tx.description.type === "split-prepare" ||
            tx.description.type === "merge-install"
                ? tx.description.actionPhase?.resultCode
                : undefined,
        success:
            tx.description.type === "generic" ||
            tx.description.type === "tick-tock" ||
            tx.description.type === "split-prepare" ||
            tx.description.type === "merge-install"
                ? tx.description.computePhase.type === "vm"
                    ? tx.description.computePhase.success && tx.description.actionPhase?.success
                    : false
                : undefined,
    }
}

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
        "statusBefore",
        "statusAfter",
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
        "statusBefore",
        "statusAfter",
        "totalFees",
        "aborted",
        "destroyed",
        "exitCode",
        "actionResultCode",
        "success",
    ],
}

function getPrettyTx(tx: FlatTransaction, args?: FlatPrintParameters): string {
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
function findClosestTxMatch(transactions: FlatTransaction[], criteria: FlatTransaction) {
    let bestMatch: FlatTransaction | undefined
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

function compareTransaction(targetTx: FlatTransaction, cmpTx: FlatTransaction): boolean {
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
    criteria: FlatTransaction,
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

const identity = <T>(x: T): T => x

export function assertTransactionChainSuccessfulEither(
    transactions: BlockchainTransaction[],
    chainLength: {
        either: number
        or: number
    },
) {
    assert(
        transactions.length === chainLength.either || transactions.length === chainLength.or,
        `Expected ${chainLength.either} or ${chainLength.or} transactions, got ${transactions.length}`,
    )
    const txStatuses = transactions.map(tx => flattenTransaction(tx).success)

    const allEitherSuccessful = txStatuses.slice(0, chainLength.either).every(identity)

    const allOrSuccessful = txStatuses.slice(0, chainLength.or).every(identity)

    assert(
        allEitherSuccessful || allOrSuccessful,
        `Not all transactions in the chain were successful. Failed transactions:\n ${transactions
            .map(tx => flattenTransaction(tx))
            .filter(tx => tx.success !== true)
            .map(v => getPrettyTx(v))}`,
    )
}

export function assertTransactionChainSuccessful(
    transactions: BlockchainTransaction[],
    chainLength: number,
) {
    assert(
        transactions.length === chainLength,
        `Expected ${chainLength} transactions, got ${transactions.length}`,
    )
    const failedTransactions = transactions.filter(tx => flattenTransaction(tx).success !== true)
    assert(
        failedTransactions.length === 0,
        `Not all transactions in the chain were successful. Failed transactions:\n ${failedTransactions.map(tx => flattenTransaction(tx)).map(v => getPrettyTx(v))}`,
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
