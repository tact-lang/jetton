import {z} from "zod"
import {Address} from "@ton/core"

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
    const network = process.env.NETWORK ?? "testnet"
    const url = new URL(
        `https://${network}.tonapi.io/v2/jettons/${address.toString({urlSafe: true})}`,
    )

    const TONAPI_KEY = process.env.TONAPI_KEY
    if (!TONAPI_KEY) {
        throw new Error("TONAPI_KEY is not set")
    }
    const response = await fetch(url.toString(), {
        headers: {
            "X-API-Key": TONAPI_KEY,
            Accept: "application/json",
        },
    })
    const data = await response.json()
    return tonapiResponseSchema.parse(data)
}
