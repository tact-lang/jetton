//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Studio

import {TonClient, WalletContractV4, Address, toNano} from "@ton/ton"
import {getHttpEndpoint} from "@orbs-network/ton-access"
import {JettonWallet} from "../output/Jetton_JettonWallet"
import {validateJettonParams, JettonParams, buildJettonMinterFromEnv} from "../utils/jetton-helpers"
import {callGetMetadataFromTonCenter, TonCenterJettonMetadata} from "../utils/toncenter"
import {mnemonicToPrivateKey} from "@ton/crypto"
import "dotenv/config"
import {JettonMinter} from "../output/Jetton_JettonMinter"
import {callGetMetadataFromTonApi} from "../utils/tonapi"
import {expect} from "@jest/globals"
import {uploadDeployResultToGist} from "../utils/gist"
import {getNetworkFromEnv} from "../utils/utils"
import {GovernanceJettonMinter} from "../output/Governance_GovernanceJettonMinter"
import {JettonMinterFeatureRich} from "../output/FeatureRich_JettonMinterFeatureRich"

describe("Contract Deployment Verification", () => {
    let client: TonClient
    let jettonMinter: JettonMinter | GovernanceJettonMinter | JettonMinterFeatureRich
    let deployerWalletAddress: Address
    let jettonParams: JettonParams

    beforeAll(async () => {
        const network = getNetworkFromEnv()

        const endpoint = await getHttpEndpoint({network})
        client = new TonClient({endpoint})

        const mnemonics = process.env.MNEMONICS
        if (mnemonics === undefined) {
            console.error("Mnemonics is not provided, please add it to .env file")
            throw new Error("Mnemonics is not provided")
        }
        if (mnemonics.split(" ").length !== 24) {
            console.error("Invalid mnemonics, it should be 24 words")
            throw new Error("Invalid mnemonics, it should be 24 words")
        }
        const keyPair = await mnemonicToPrivateKey(mnemonics.split(" "))
        const workchain = 0
        deployerWalletAddress = WalletContractV4.create({
            workchain,
            publicKey: keyPair.publicKey,
        }).address

        const metadata = {
            name: process.env.JETTON_NAME ?? "TactJetton",
            description:
                process.env.JETTON_DESCRIPTION ??
                "This is description of Jetton, written in Tact-lang",
            symbol: process.env.JETTON_SYMBOL ?? "TACT",
            image:
                process.env.JETTON_IMAGE ??
                "https://raw.githubusercontent.com/tact-lang/tact/refs/heads/main/docs/public/logomark-light.svg",
        }

        jettonMinter = await buildJettonMinterFromEnv(deployerWalletAddress, "base")
        jettonParams = {
            address: jettonMinter.address,
            metadata: metadata,
            totalSupply: toNano(Number(process.env.JETTON_SUPPLY ?? 1000000000)),
            owner: deployerWalletAddress,
            jettonWalletCode: (
                await JettonWallet.init(deployerWalletAddress, jettonMinter.address, 0n)
            ).code,
        }
    })

    afterAll(async () => {
        await uploadDeployResultToGist(jettonMinter.address)
    })

    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

    // skipped since testnet.toncenter doesn't index recent deployments
    it.skip("should be deployed with correct parameters", async () => {
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
        let metadata: TonCenterJettonMetadata | undefined

        while (attempt < maxAttempts) {
            await sleep(sleepTime)
            attempt++
            const toncenterResponse = await callGetMetadataFromTonCenter(jettonMinter.address)
            const resultParams = toncenterResponse[jettonParams.address.toRawString().toUpperCase()]

            if (typeof resultParams !== "undefined") {
                console.log(
                    `Contract is discovered by TonCenter, attempt ${attempt}/${maxAttempts}`,
                )
                metadata = resultParams
                break
            }

            console.log(
                `Contract is not discovered by TonCenter, attempt ${attempt}/${maxAttempts}`,
            )
        }
        if (!metadata) {
            throw new Error("Contract is not indexed by TonCenter")
        }

        expect(metadata).toBeDefined()
        expect(metadata.token_info[0].type).toBe("jetton_masters")

        // This code is commented as TonCenter has an issue https://github.com/tact-lang/jetton/issues/87
        // expect(resultParams.is_indexed).toBe(true)

        if (metadata.is_indexed) {
            expect(metadata.token_info[0].name).toBe(jettonParams.metadata.name)
            expect(metadata.token_info[0].description).toBe(jettonParams.metadata.description)
            expect(metadata.token_info[0].image).toBe(jettonParams.metadata.image)
        }
    }, 60000) // Increased as we need to wait for the contract to be indexed by TonCenter

    it("should be recognized by TonApi", async () => {
        const response = await callGetMetadataFromTonApi(jettonMinter.address)
        expect(response.admin.address.toUpperCase()).toBe(
            jettonParams.owner.toRawString().toUpperCase(),
        )
        expect(response.metadata.address.toUpperCase()).toBe(
            jettonParams.address.toRawString().toUpperCase(),
        )
        expect(response.metadata.name).toBe(jettonParams.metadata.name)
        expect(response.metadata.symbol).toBe(jettonParams.metadata.symbol)
        expect(response.metadata.image).toBe(jettonParams.metadata.image)
        expect(response.metadata.description).toBe(jettonParams.metadata.description)
    })
})
