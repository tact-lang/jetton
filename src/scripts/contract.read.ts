import "dotenv/config"
import {getHttpEndpoint} from "@orbs-network/ton-access"
import {Address} from "@tact-lang/compiler/core"
import {createInterface} from "readline/promises"
import {TonClient} from "@ton/ton"
import {JettonMinter} from "../output/Jetton_JettonMinter"
import {displayContentCell} from "../utils/jetton-helpers"
import chalk from "chalk"

const readContractAddress = async () => {
    const readline = createInterface({
        input: process.stdin,
        output: process.stdout,
    })

    while (true) {
        try {
            const minterAddress = await readline.question("Enter minter address: ")
            const address = Address.parse(minterAddress)
            readline.close()
            return address
        } catch (e) {
            console.error("Invalid address, please try again.")
        }
    }
}

const main = async () => {
    const network = process.env.NETWORK ?? "testnet"

    if (network !== "mainnet" && network !== "testnet") {
        console.error("Invalid network, should be mainnet or testnet, got ", network)
        throw new Error("Invalid network")
    }

    const endpoint = await getHttpEndpoint({network: network})
    const client = new TonClient({
        endpoint: endpoint,
    })

    const minterAddress = await readContractAddress()
    const minter = client.open(JettonMinter.fromAddress(minterAddress))

    const minterData = await minter.getGetJettonData()

    console.log("\nMinter data")
    console.log(`Total supply: ${chalk.yellowBright(minterData.totalSupply)}`)
    console.log(`Owner: ${chalk.underline(minterData.adminAddress)}`)
    console.log(
        `Is mintable: ${minterData.mintable ? chalk.greenBright("Yes") : chalk.redBright("No")}`,
    )
    await displayContentCell(minterData.jettonContent)
}

void main()
