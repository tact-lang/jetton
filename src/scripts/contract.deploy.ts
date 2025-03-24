//Huge thanks to Howard Peng for the original code of deploy script. https://github.com/howardpen9/jetton-implementation-in-tact

import {beginCell, toNano, TonClient, WalletContractV4, internal, fromNano} from "@ton/ton"
import {getHttpEndpoint} from "@orbs-network/ton-access"
import {mnemonicToPrivateKey} from "@ton/crypto"
import {buildJettonMinterFromEnv} from "../utils/jetton-helpers"
import {storeMint} from "../output/Jetton_JettonMinter"

import {printSeparator} from "../utils/print"
import * as dotenv from "dotenv"
dotenv.config()

/*
    (Remember to install dependencies by running "yarn install" in the terminal)
    Here are the instructions to deploy the contract:
    1. Create new walletV4r2 or use existing one.
    2. Enter your mnemonics in .env file. (.env.example is provided)
    3. In .env file specify the network you want to deploy the contract.
    (testnet is chosen by default, if you are not familiar with it, read https://tonkeeper.helpscoutdocs.com/article/100-how-switch-to-the-testnet)

    4. In .env file specify the parameters of the Jetton. (Ticker, description, image, etc.)
    5. In .env file specify the total supply of the Jetton. It will be automatically converted to nano - jettons.
    Note: All supply will be automatically minted to your wallet.

    6. Run "yarn build" to compile the contract.
    7. Run this script by "yarn deploy"
 */
const main = async () => {
    let mnemonics = (process.env.mnemonics || "").toString() // 🔴 Mnemonic should be placed in .env file
    const network = process.env.network ?? "testnet"
    if (network != "mainnet" && network != "testnet") {
        throw new Error("Invalid network")
    }
    const endpoint = await getHttpEndpoint({network: network})
    const client = new TonClient({
        endpoint: endpoint,
    })
    const split_mnemonics = mnemonics.split(" ")
    console.log(split_mnemonics[0], split_mnemonics[1])
    const keyPair = await mnemonicToPrivateKey(split_mnemonics)
    const secretKey = keyPair.secretKey
    const workchain = 0 //we are working in basechain.
    const deployer_wallet = WalletContractV4.create({workchain, publicKey: keyPair.publicKey})

    const deployer_wallet_contract = client.open(deployer_wallet)

    const jettonMinter = await buildJettonMinterFromEnv(deployer_wallet_contract.address)
    const deployAmount = toNano("0.15")

    const supply = toNano(Number(process.env.jettonSupply) ?? 1000000000)
    const packed_msg = beginCell()
        .store(
            storeMint({
                $$type: "Mint",
                queryId: 0n,
                mintMessage: {
                    $$type: "JettonTransferInternal",
                    amount: supply,
                    sender: deployer_wallet_contract.address,
                    responseDestination: deployer_wallet_contract.address,
                    queryId: 0n,
                    forwardTonAmount: 0n,
                    forwardPayload: beginCell().storeUint(0, 1).asSlice(),
                },
                receiver: deployer_wallet_contract.address,
                tonAmount: supply,
            }),
        )
        .endCell()

    // send a message on new address contract to deploy it
    const seqno: number = await deployer_wallet_contract.getSeqno()
    console.log(
        "🛠️Preparing new outgoing massage from deployment wallet. \n" +
            deployer_wallet_contract.address,
    )
    console.log("Seqno: ", seqno + "\n")
    printSeparator()

    // Get deployment wallet balance
    const balance: bigint = await deployer_wallet_contract.getBalance()

    console.log("Current deployment wallet balance = ", fromNano(balance).toString(), "💎TON")
    console.log("Minting:: ", fromNano(supply))
    printSeparator()

    await deployer_wallet_contract.sendTransfer({
        seqno,
        secretKey,
        messages: [
            internal({
                to: jettonMinter.address,
                value: deployAmount,
                init: {
                    code: jettonMinter.init?.code,
                    data: jettonMinter.init?.data,
                },
                body: packed_msg,
            }),
        ],
    })
    console.log("====== Deployment message sent to =======\n", jettonMinter.address)
}

void main()
