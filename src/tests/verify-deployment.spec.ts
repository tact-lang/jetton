import {TonClient, WalletContractV4, Address, toNano} from "@ton/ton"
import {getHttpEndpoint} from "@orbs-network/ton-access"
import {JettonWallet} from "../output/Jetton_JettonWallet"
import {validateJettonParams, JettonParams, buildJettonMinterFromEnv} from "../utils/jetton-helpers"
import {
    callGetMetadataFromTonCenter,
    TonCenterResponse,
    validateTonCenterResponse,
} from "../utils/toncenter"
import {mnemonicToPrivateKey} from "@ton/crypto"
import * as dotenv from "dotenv"
import {JettonMinter} from "../output/Jetton_JettonMinter"
import {callGetMetadataFromTonApi, validateTonApiResponse} from "../utils/tonapi"
dotenv.config()

describe("Contract Deployment Verification", () => {
    let client: TonClient
    let jettonMinter: JettonMinter
    let deployerWalletAddress: Address
    let jettonParams: JettonParams

    beforeAll(async () => {
        const network = process.env.network ?? "testnet"
        if (network !== "testnet" && network !== "mainnet") {
            throw new Error("Invalid network")
        }
        const endpoint = await getHttpEndpoint({network: network as "testnet" | "mainnet"})
        client = new TonClient({endpoint})

        const mnemonics = (process.env.mnemonics || "").toString()
        const keyPair = await mnemonicToPrivateKey(mnemonics.split(" "))
        const workchain = 0
        deployerWalletAddress = WalletContractV4.create({
            workchain,
            publicKey: keyPair.publicKey,
        }).address

        const metadata = {
            name: process.env.jettonName ?? "TactJetton",
            description:
                process.env.jettonDescription ??
                "This is description of Jetton, written in Tact-lang",
            symbol: process.env.jettonSymbol ?? "TACT",
            image:
                process.env.jettonImage ??
                "https://raw.githubusercontent.com/tact-lang/tact/refs/heads/main/docs/public/logomark-light.svg",
        }

        jettonMinter = await buildJettonMinterFromEnv(deployerWalletAddress)
        jettonParams = {
            address: jettonMinter.address,
            metadata: metadata,
            totalSupply: toNano(Number(process.env.jettonSupply ?? 1000000000)),
            owner: deployerWalletAddress,
            jettonWalletCode: (
                await JettonWallet.init(0n, deployerWalletAddress, jettonMinter.address)
            ).code,
        }
    })

    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

    it("should be deployed with correct parameters", async () => {
        const sleepTime = 5000
        const maxAttempts = 10
        let attempts = 0

        while (attempts < maxAttempts) {
            await sleep(sleepTime)
            attempts++

            const contractState = await client.getContractState(jettonMinter.address)
            if (contractState.state !== "active") {
                console.log(`Contract is not active yet, attempt ${attempts}/${maxAttempts}`)
                continue
            }

            await validateJettonParams(jettonParams, jettonMinter.address, client)
            expect(contractState.state).toBe("active")
            return
        }

        throw new Error("Contract deployment verification failed")
    }, 60000) // Increased timeout for the test as we need to wait for the contract to be deployed

    it("should be recognized by TonCenter", async () => {
        const sleepTime = 5000
        const maxAttempts = 10
        let attempt = 0
        let metadata: TonCenterResponse | undefined

        while (attempt < maxAttempts) {
            await sleep(sleepTime)
            attempt++
            metadata = await callGetMetadataFromTonCenter(jettonMinter.address)
            if (metadata.is_indexed) {
                console.log(`Contract is indexed by TonCenter, attempt ${attempt}/${maxAttempts}`)
                break
            }
            console.log(`Contract is not indexed by TonCenter, attempt ${attempt}/${maxAttempts}`)
        }
        if (!metadata) {
            throw new Error("Contract is not indexed by TonCenter")
        }
        await validateTonCenterResponse(metadata, jettonParams)
    }, 30000) // Increased as we need to wait for the contract to be indexed by TonCenter

    it("should be recognized by TonApi", async () => {
        const metadata = await callGetMetadataFromTonApi(jettonMinter.address)
        await validateTonApiResponse(metadata, jettonParams)
    })
})
