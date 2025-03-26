import {z} from "zod"
import {Address} from "@ton/ton"

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

export type TonCenterResponse = z.infer<typeof tonCenterResponseSchema>

export const callGetMetadataFromTonCenter = async (
    address: Address,
): Promise<TonCenterResponse> => {
    const network = process.env.NETWORK ?? "testnet"
    const url = new URL(`https://${network}.toncenter.com/api/v3/metadata`)
    url.searchParams.append("address", address.toString({urlSafe: true}))

    const TONCENTER_KEY = process.env[`TONCENTER_${network.toUpperCase()}_KEY`]
    if (!TONCENTER_KEY) {
        throw new Error(`TONCENTER_${network.toUpperCase()}_KEY is not set`)
    }

    const response = await fetch(url.toString(), {
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
