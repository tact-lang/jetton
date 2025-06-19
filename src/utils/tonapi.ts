//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Studio

import {z} from "zod"
import {Address} from "@ton/core"
import {getJettonHttpLink, getNetworkFromEnv} from "./utils"

const tonapiResponseSchema = z.object({
    mintable: z.boolean(),
    total_supply: z.string(),
    admin: z.object({
        address: z.string(),
    }),
    metadata: z.object({
        address: z.string(),
        name: z.string(),
        symbol: z.string(),
        decimals: z.string(),
        image: z.string(),
        description: z.string(),
    }),
    preview: z.string(),
    verification: z.string(),
    holders_count: z.number(),
})

export type TonApiResponse = z.infer<typeof tonapiResponseSchema>

export const callGetMetadataFromTonApi = async (address: Address): Promise<TonApiResponse> => {
    const network = getNetworkFromEnv()

    const url = getJettonHttpLink(network, address, "tonapi")

    const TONAPI_KEY = process.env.TONAPI_KEY
    if (!TONAPI_KEY) {
        throw new Error("TONAPI_KEY is not set")
    }
    const response = await fetch(url, {
        headers: {
            "X-API-Key": TONAPI_KEY,
            Accept: "application/json",
        },
    })
    const data = await response.json()
    return tonapiResponseSchema.parse(data)
}
