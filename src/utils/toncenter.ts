//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Studio

import {z} from "zod"
import {Address} from "@ton/ton"
import {getJettonHttpLink, getNetworkFromEnv} from "./utils"

const tokenSchema = z.object({
    type: z.string(),
    name: z.string().optional(),
    symbol: z.string().optional(),
    description: z.string().optional(),
    image: z.string().optional(),
})

const tokenMetadataSchema = z.object({
    is_indexed: z.boolean(),
    token_info: z.array(tokenSchema),
})

const tonCenterResponseSchema = z.record(tokenMetadataSchema)

type TonCenterResponse = z.infer<typeof tonCenterResponseSchema>
export type TonCenterJettonMetadata = z.infer<typeof tokenMetadataSchema>

export const callGetMetadataFromTonCenter = async (
    address: Address,
): Promise<TonCenterResponse> => {
    const network = getNetworkFromEnv()
    const url = getJettonHttpLink(network, address, "toncenter")

    const TONCENTER_KEY = process.env[`TONCENTER_${network.toUpperCase()}_KEY`]
    if (!TONCENTER_KEY) {
        throw new Error(`TONCENTER_${network.toUpperCase()}_KEY is not set`)
    }

    const response = await fetch(url, {
        headers: {
            "X-API-Key": TONCENTER_KEY,
            Accept: "application/json",
        },
    })

    const rawJson = await response.json()

    try {
        return tonCenterResponseSchema.parse(rawJson)
    } catch (error) {
        console.error("Validation error:", error)
        throw error
    }
}
