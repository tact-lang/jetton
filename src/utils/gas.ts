import type {SendMessageResult} from "@ton/sandbox"

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
        .map(t =>
            t.description.type === "generic" && t.description.computePhase.type === "vm"
                ? Number(t.description.computePhase.gasUsed)
                : 0,
        )
        .reduceRight((prev, cur) => prev + cur)
}
