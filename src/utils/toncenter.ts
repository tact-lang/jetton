import {z} from "zod"
import {JettonParams} from "./jetton-helpers"
import {Address} from "@ton/ton"
import {expect} from "@jest/globals"

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
    const network = process.env.network ?? "testnet"
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

export const validateTonCenterResponse = async (
    response: TonCenterResponse,
    expectedJettonParams: JettonParams,
) => {
    const resultParams = response[expectedJettonParams.address.toRawString().toUpperCase()]
    expect(resultParams).toBeDefined()
    expect(resultParams.token_info[0].type).toBe("jetton_masters")
    if (resultParams.is_indexed) {
        expect(resultParams.token_info[0].name).toBe(expectedJettonParams.metadata.name)
        expect(resultParams.token_info[0].description).toBe(
            expectedJettonParams.metadata.description,
        )
        expect(resultParams.token_info[0].image).toBe(expectedJettonParams.metadata.image)
    }
}
