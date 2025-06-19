//  SPDX-License-Identifier: MIT
//  Copyright © 2023 TON Foundation
// https://github.com/ton-blockchain/token-contract/blob/568f9c5c291b3cba39bfa75c1770c569c613796e/sandbox_tests/utils.ts

import {Address, toNano, Cell, Builder, beginCell} from "@ton/core"
import {randomBytes} from "crypto"

export const randomAddress = (wc: number = 0) => {
    const buf = Buffer.alloc(32)
    for (let i = 0; i < buf.length; i++) {
        buf[i] = Math.floor(Math.random() * 256)
    }
    return new Address(wc, buf)
}

export const differentAddress = (old: Address) => {
    let newAddr: Address
    do {
        newAddr = randomAddress(old.workChain)
    } while (newAddr.equals(old))

    return newAddr
}

export const getNetworkFromEnv = () => {
    const envNetwork = process.env.NETWORK
    if (envNetwork === "mainnet" || envNetwork === "testnet") {
        return envNetwork
    } else {
        return "testnet"
    }
}

const getNetworkSubdomain = (network: "mainnet" | "testnet") => {
    return network === "mainnet" ? "" : network + "."
}

type HttpJettonLink = "tonviewer" | "tonapi" | "toncenter" | "tonscan"

export const getJettonHttpLink = (
    network: "mainnet" | "testnet",
    minterAddress: Address,
    linkType: HttpJettonLink,
) => {
    const subdomain = getNetworkSubdomain(network)
    const address = minterAddress.toString({urlSafe: true})

    switch (linkType) {
        case "tonviewer":
            return `https://${subdomain}tonviewer.com/${address}`
        case "tonapi":
            return `https://${subdomain}tonapi.io/v2/jettons/${address}`
        case "toncenter":
            return `https://${subdomain}toncenter.com/api/v3/metadata?address=${address}`
        case "tonscan":
            return `https://${subdomain}tonscan.org/address/${address}`
        default:
            throw new Error("Invalid link type")
    }
}

const getRandom = (min: number, max: number) => {
    return Math.random() * (max - min) + min
}

export const getRandomInt = (min: number, max: number) => {
    return Math.round(getRandom(min, max))
}

export const getRandomTon = (min: number, max: number): bigint => {
    return toNano(getRandom(min, max).toFixed(9))
}

export type InternalTransfer = {
    from: Address | null
    response: Address | null
    amount: bigint
    forwardAmount: bigint
    payload: Cell | null
}
export type JettonTransfer = {
    to: Address
    response_address: Address | null
    amount: bigint
    custom_payload: Cell | null
    forward_amount: bigint
    forward_payload: Cell | null
}

export const parseTransfer = (body: Cell) => {
    const ts = body.beginParse().skip(64 + 32)
    return {
        amount: ts.loadCoins(),
        to: ts.loadAddress(),
        response_address: ts.loadAddressAny(),
        custom_payload: ts.loadMaybeRef(),
        forward_amount: ts.loadCoins(),
        forward_payload: ts.loadMaybeRef(),
    }
}
export const parseInternalTransfer = (body: Cell) => {
    const ts = body.beginParse().skip(64 + 32)

    return {
        amount: ts.loadCoins(),
        from: ts.loadAddressAny(),
        response: ts.loadAddressAny(),
        forwardAmount: ts.loadCoins(),
        payload: ts.loadMaybeRef(),
    }
}

export const parseTransferNotification = (body: Cell) => {
    const bs = body.beginParse().skip(64 + 32)
    return {
        amount: bs.loadCoins(),
        from: bs.loadAddressAny(),
        payload: bs.loadMaybeRef(),
    }
}

export const parseBurnNotification = (body: Cell) => {
    const ds = body.beginParse().skip(64 + 32)
    const res = {
        amount: ds.loadCoins(),
        from: ds.loadAddress(),
        response_address: ds.loadAddressAny(),
    }

    return res
}

export const storeBigPayload = (curBuilder: Builder, maxDepth: number = 5) => {
    const rootBuilder = curBuilder

    function dfs(builder: Builder, currentDepth: number) {
        if (currentDepth >= maxDepth) {
            return
        }
        // Cell has a capacity of 1023 bits, so we can store 127 bytes max
        builder.storeBuffer(randomBytes(127))
        // Store all 4 references
        for (let i = 0; i < 4; i++) {
            const newBuilder = beginCell()
            dfs(newBuilder, currentDepth + 1)
            builder.storeRef(newBuilder.endCell())
        }
    }

    dfs(rootBuilder, 0) // Start DFS with depth 0
    return rootBuilder
}
