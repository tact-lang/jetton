//Huge thanks to Howard Peng for the original code of deploy script. https://github.com/howardpen9/jetton-implementation-in-tact

import {beginCell, toNano, TonClient, WalletContractV4, internal, fromNano} from "@ton/ton"
import {getHttpEndpoint} from "@orbs-network/ton-access"
import {mnemonicToPrivateKey} from "@ton/crypto"
import {buildJettonMinterFromEnv} from "../utils/jetton-helpers"
import {storeMint} from "../output/Jetton_JettonMinter"

import {printSeparator} from "../utils/print"
import "dotenv/config"

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
    const mnemonics = process.env.MNEMONICS
    if (mnemonics === undefined) {
        console.error("Mnemonics is not provided, please add it to .env file")
        throw new Error("Mnemonics is not provided")
    }
    if (mnemonics.split(" ").length !== 24) {
        console.error("Invalid mnemonics, it should be 24 words")
        throw new Error("Invalid mnemonics, it should be 24 words")
    }
    const network = process.env.NETWORK ?? "testnet"
    if (network !== "mainnet" && network !== "testnet") {
        console.error("Invalid network, should be mainnet or testnet, got ", network)
        throw new Error("Invalid network")
    }
    const endpoint = await getHttpEndpoint({network: network})
    const client = new TonClient({
        endpoint: endpoint,
    })
    const keyPair = await mnemonicToPrivateKey(mnemonics.split(" "))
    const secretKey = keyPair.secretKey
    const workchain = 0 //we are working in basechain.
    const deployerWallet = WalletContractV4.create({
        workchain: workchain,
        publicKey: keyPair.publicKey,
    })

    const deployerWalletContract = client.open(deployerWallet)

    const jettonMinter = await buildJettonMinterFromEnv(deployerWalletContract.address)
    const deployAmount = toNano("0.15")

    const supply = toNano(Number(process.env.JETTON_SUPPLY ?? 1000000000)) // 1_000_000_000 jettons
    const packed_msg = beginCell()
        .store(
            storeMint({
                $$type: "Mint",
                queryId: 0n,
                mintMessage: {
                    $$type: "JettonTransferInternal",
                    amount: supply,
                    sender: deployerWalletContract.address,
                    responseDestination: deployerWalletContract.address,
                    queryId: 0n,
                    forwardTonAmount: 0n,
                    forwardPayload: beginCell().storeUint(0, 1).asSlice(),
                },
                receiver: deployerWalletContract.address,
                jettonAmount: supply,
            }),
        )
        .endCell()

    // send a message on new address contract to deploy it
    const seqno: number = await deployerWalletContract.getSeqno()
    console.log(
        "🛠️Preparing new outgoing massage from deployment wallet. \n" +
            deployerWalletContract.address,
    )
    console.log("Seqno: ", seqno + "\n")
    printSeparator()

    // Get deployment wallet balance
    const balance: bigint = await deployerWalletContract.getBalance()

    console.log("Current deployment wallet balance = ", fromNano(balance).toString(), "💎TON")
    console.log("Minting:: ", fromNano(supply))
    printSeparator()

    await deployerWalletContract.sendTransfer({
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
    console.log(
        `You can soon check your deployed contract at https://${network === "mainnet" ? "" : network + "."}tonviewer.com/${jettonMinter.address.toString({urlSafe: true})}`,
    )
}

void main()
