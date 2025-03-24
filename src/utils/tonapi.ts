import {z} from "zod"
import {JettonParams} from "./jetton-helpers"

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

export const callGetMetadataFromTonApi = async (address: string): Promise<TonApiResponse> => {
    const network = process.env.network ?? "testnet"
    const url = new URL(`https://${network}.tonapi.io/v2/jettons/${address}`)

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

export const validateTonApiResponse = async (
    response: TonApiResponse,
    expectedJettonParams: JettonParams,
) => {
    expect(response.admin.address.toUpperCase()).toBe(
        expectedJettonParams.owner.toRawString().toUpperCase(),
    )
    expect(response.metadata.address.toUpperCase()).toBe(
        expectedJettonParams.address.toRawString().toUpperCase(),
    )
    expect(response.metadata.name).toBe(expectedJettonParams.metadata.name)
    expect(response.metadata.symbol).toBe(expectedJettonParams.metadata.symbol)
    expect(response.metadata.image).toBe(expectedJettonParams.metadata.image)
    expect(response.metadata.description).toBe(expectedJettonParams.metadata.description)
}
