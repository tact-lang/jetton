//  SPDX-License-Identifier: MIT
//  Copyright © 2023 @howardpen9 @0kenx
//  Based on https://github.com/howardpen9/jetton-implementation-in-tact/blob/d996d51c59e672aa9eabb028869e0e4d6135a8cb/sources/utils/print.ts
//  Modified by TON Studio

import {Address, beginCell, Cell, contractAddress, storeStateInit} from "@ton/ton"
import qs from "qs"
import base64url from "base64url"

export function printSeparator() {
    console.log(
        "========================================================================================",
    )
}

export function printHeader(name: string) {
    printSeparator()
    console.log("Contract: " + name)
    printSeparator()
}

export function printAddress(address: Address, testnet: boolean = true) {
    console.log("Address: " + address.toString({testOnly: testnet}))
    console.log(
        "Explorer: " +
            "https://" +
            (testnet ? "testnet." : "") +
            "tonapi.io/account/" +
            address.toString({testOnly: testnet}),
    )
    printSeparator()
}

export function printDeploy(
    init: {code: Cell; data: Cell},
    value: bigint,
    command: Cell | string,
    testnet: boolean = true,
) {
    // Resolve target address
    const to = contractAddress(0, init)

    // Resolve init
    const initStr = base64url(beginCell().store(storeStateInit(init)).endCell().toBoc({idx: false}))

    let link: string
    if (typeof command === "string") {
        link =
            `https://${testnet ? "test." : ""}tonhub.com/transfer/` +
            to.toString({testOnly: testnet}) +
            "?" +
            qs.stringify({
                text: command,
                amount: value.toString(10),
                init: initStr,
            })
    } else {
        link =
            `https://${testnet ? "test." : ""}tonhub.com/transfer/` +
            to.toString({testOnly: testnet}) +
            "?" +
            qs.stringify({
                text: "Deploy contract",
                amount: value.toString(10),
                init: initStr,
                bin: base64url(command.toBoc({idx: false})),
            })
    }
    console.log("Deploy: " + link)
    printSeparator()
}
